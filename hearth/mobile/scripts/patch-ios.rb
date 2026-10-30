#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds Hearth's own parts to the iPhone project that `npx cap add ios` generates (there's no committed ios/
# folder; the "Hearth apps" workflow builds it fresh every time, like Android's with patch-android.js):
#   - the App target's Swift sources (ios-native/App/*.swift; AppDelegate.swift and SceneDelegate.swift replace
#     Capacitor's, so the window shows HearthViewController and push tokens and links reach Hearth's code);
#   - the NotificationService extension (decrypts what a push really says, on the phone) and the ShareExtension
#     (Share > Hearth for a TikTok or Instagram link), both embedded in the app;
#   - the HearthKit Swift package (ios-native/HearthKit) linked into all three;
#   - Info.plist keys (microphone and camera, background audio for calls, hearth:// links, light status bar, the
#     export compliance answer, saved files in the Files app), the entitlements (push, Time Sensitive rings, the
#     App Group and Keychain group the extensions share, and the invite links of HEARTH_SERVER) and the ring sound;
#   - build settings: iOS 16.4, Swift 5, the version, the team and how each target is signed.
# Every step checks the template still looks the way this expects and stops with an error if not, and running it
# twice changes nothing more. It ends with check_patched, which reads everything back.
#
# Usage (from hearth/mobile, after `npx cap add ios`; Ruby gems from Gemfile.lock, so `bundle exec`):
#   bundle exec ruby scripts/patch-ios.rb ios            patch ios/, then check it
#   bundle exec ruby scripts/patch-ios.rb --check ios    only check (the workflow runs it again after cap sync)
# Environment, all optional:
#   SERVER                  the baked-in server (https://host): its invite links open the app (Universal Links)
#   APPLE_TEAM_ID           the 10-character Apple team, for signing
#   VERSION_NAME            1.43.0 (anything after - or + is dropped: iOS takes only numbers)
#   VERSION_CODE            the build number, the same formula as Android's versionCode
#   IOS_PROFILE_APP / IOS_PROFILE_NSE / IOS_PROFILE_SHARE
#                           names of App Store provisioning profiles: signs by hand with them (option B in
#                           docs/SIGNING.md) instead of Xcode's cloud-managed signing (option A)
#   HEARTH_CUSTOM_SERVER=1  compiles in the prompt for a server's self-signed certificate (never for the App Store)
require 'fileutils'
require 'xcodeproj'

MOBILE = File.expand_path('..', __dir__)
NATIVE = File.join(MOBILE, 'ios-native')
RESOURCES = File.join(NATIVE, 'resources')

DEPLOYMENT_TARGET = '16.4'
APP_GROUP = 'group.app.hearth.mobile'
KEYCHAIN_GROUP = "$(AppIdentifierPrefix)#{APP_GROUP}"
# Seen from ios/App, where App.xcodeproj is.
HEARTHKIT_PATH = '../../ios-native/HearthKit'
EMBED_PHASE = 'Embed Foundation Extensions'
RING = 'ring.wav'
RING_MAX_SECONDS = 30 # iOS plays the default sound instead of a longer one

EXTENSIONS = [
  { name: 'NotificationService', bundle: 'app.hearth.mobile.NotificationService', profile: 'IOS_PROFILE_NSE',
    point: 'com.apple.usernotifications.service', principal: 'NotificationService', keychain: true },
  { name: 'ShareExtension', bundle: 'app.hearth.mobile.ShareExtension', profile: 'IOS_PROFILE_SHARE',
    point: 'com.apple.share-services', principal: 'ShareViewController', keychain: false },
].freeze

# What the App's Info.plist must say. No NSAppTransportSecurity exceptions: the App Store build only talks to its
# one server over https with a publicly trusted certificate.
APP_PLIST = {
  'NSMicrophoneUsageDescription' => 'Hearth uses the microphone for voice and video calls and voice messages.',
  'NSCameraUsageDescription' => 'Hearth uses the camera for video calls and for photos you choose to send.',
  # Keeps a call that's already going alive with the screen locked (CallAudio); no silent pushes, so no
  # remote-notification.
  'UIBackgroundModes' => ['audio'],
  'CFBundleURLTypes' => [{ 'CFBundleURLName' => 'app.hearth.mobile.invite', 'CFBundleURLSchemes' => ['hearth'] }],
  'UIStatusBarStyle' => 'UIStatusBarStyleLightContent',
  'UIViewControllerBasedStatusBarAppearance' => false,
  # Hearth's encryption is standard and exempt (docs/IOS-STORE.md, export compliance): TestFlight stops asking.
  'ITSAppUsesNonExemptEncryption' => false,
  # Files saved through the share sheet's "Save to Files" show up under On My iPhone > Hearth.
  'UIFileSharingEnabled' => true,
  'LSSupportsOpeningDocumentsInPlace' => true,
}.freeze

def fail!(msg)
  warn "patch-ios: #{msg}"
  exit 1
end

def env(name)
  v = ENV[name].to_s.strip
  v.empty? ? nil : v
end

# The host for applinks: an https origin with a plain host name and no port (Associated Domains has no ports).
def applinks_host(server)
  return nil unless server
  m = %r{\Ahttps://([a-z0-9.-]+)/?\z}i.match(server.strip)
  m ? m[1].downcase : nil
end

def marketing_version
  v = env('VERSION_NAME')
  return nil unless v
  v = v.split(/[-+]/, 2).first
  fail!("VERSION_NAME #{ENV['VERSION_NAME'].inspect} is not a version like 1.43.0") unless v =~ /\A\d+(\.\d+){0,2}\z/
  v
end

def build_number
  v = env('VERSION_CODE')
  return nil unless v
  fail!("VERSION_CODE #{v.inspect} is not a number") unless v =~ /\A[1-9]\d{0,17}\z/
  v
end

def team_id
  t = env('APPLE_TEAM_ID')
  return nil unless t
  fail!('APPLE_TEAM_ID is not a 10-character team ID') unless t =~ /\A[A-Z0-9]{10}\z/
  t
end

def custom_server?
  ENV['HEARTH_CUSTOM_SERVER'] == '1'
end

# A target signed by hand: the profile name for it, or nil for Xcode's automatic (cloud-managed) signing.
def profile_for(var)
  p = env(var)
  fail!("#{var} is not a provisioning profile name") if p && p !~ /\A[\w .()-]{1,200}\z/
  p
end

def manual_signing?
  ['IOS_PROFILE_APP', *EXTENSIONS.map { |e| e[:profile] }].any? { |v| env(v) }
end

def paths(ios)
  app_root = File.join(ios, 'App')
  { root: app_root, project: File.join(app_root, 'App.xcodeproj'), app: File.join(app_root, 'App') }
end

def swift_sources(dir)
  files = Dir[File.join(NATIVE, dir, '*.swift')].sort
  fail!("no Swift sources in ios-native/#{dir}") if files.empty?
  files
end

def copy_if_changed(src, dest)
  FileUtils.mkdir_p(File.dirname(dest))
  FileUtils.cp(src, dest) unless File.exist?(dest) && FileUtils.compare_file(src, dest)
end

def group_named(parent, name)
  parent.children.find { |c| c.is_a?(Xcodeproj::Project::Object::PBXGroup) && (c.path == name || c.name == name) } ||
    parent.new_group(name, name)
end

def file_in(group, name)
  group.files.find { |f| f.path == name } || group.new_reference(name)
end

def add_source(target, ref)
  target.source_build_phase.add_file_reference(ref, true)
end

def add_resource(target, ref)
  target.resources_build_phase.add_file_reference(ref, true)
end

# ---------------------------------------------------------------------------------------------------- patching

def patch_app_sources(project, app, app_dir)
  %w[AppDelegate.swift SceneDelegate.swift].each do |f|
    fail!("ios/App/App/#{f} is missing: did `npx cap add ios` change its template?") unless File.exist?(File.join(app_dir, f))
  end
  scene = File.read(File.join(app_dir, 'SceneDelegate.swift'))
  unless scene.include?('CAPBridgeViewController()') || scene.include?('HearthViewController()')
    fail!("ios/App/App/SceneDelegate.swift doesn't create CAPBridgeViewController(): Capacitor's template changed, check ios-native/App/SceneDelegate.swift against it")
  end
  group = project.main_group.children.find { |c| c.display_name == 'App' && c.respond_to?(:files) }
  fail!('no App group in the project') unless group
  names = swift_sources('App').map { |src| File.basename(src) }
  %w[AppDelegate.swift SceneDelegate.swift].each do |f|
    fail!("ios-native/App/#{f} is missing: it replaces Capacitor's") unless names.include?(f)
  end
  swift_sources('App').each do |src|
    name = File.basename(src)
    copy_if_changed(src, File.join(app_dir, name))
    add_source(app, file_in(group, name))
  end
  group
end

def patch_ring(app, group, app_dir)
  copy_if_changed(File.join(RESOURCES, RING), File.join(app_dir, RING))
  add_resource(app, file_in(group, RING))
end

def entitlements(template, app:, keychain:)
  e = Xcodeproj::Plist.read_from_path(File.join(RESOURCES, template))
  fail!("#{template} has no App Group") unless e['com.apple.security.application-groups'] == [APP_GROUP]
  fail!("#{template}: the first keychain-access-groups entry must be #{KEYCHAIN_GROUP}") if keychain && e['keychain-access-groups']&.first != KEYCHAIN_GROUP
  if app
    # A distribution profile (option B) signs the archive itself, so it must already say production. Cloud-managed
    # signing (option A) archives with a development profile and Xcode sets production when it exports for the
    # App Store.
    e['aps-environment'] = manual_signing? ? 'production' : 'development'
    host = applinks_host(env('SERVER'))
    if host
      e['com.apple.developer.associated-domains'] = ["applinks:#{host}"]
    else
      e.delete('com.apple.developer.associated-domains')
    end
  end
  e
end

def write_plist_if_changed(hash, path)
  return if File.exist?(path) && Xcodeproj::Plist.read_from_path(path) == hash
  Xcodeproj::Plist.write_to_path(hash, path)
end

def patch_app_entitlements(group, app_dir)
  write_plist_if_changed(entitlements('App.entitlements', app: true, keychain: true), File.join(app_dir, 'App.entitlements'))
  file_in(group, 'App.entitlements')
end

def patch_app_plist(app_dir)
  path = File.join(app_dir, 'Info.plist')
  plist = Xcodeproj::Plist.read_from_path(path)
  %w[CFBundleShortVersionString CFBundleVersion].each do |k|
    fail!("Info.plist #{k} isn't from the build settings: Capacitor's template changed") unless plist[k].to_s.start_with?('$(')
  end
  plist.merge!(APP_PLIST)
  plist.delete('NSAppTransportSecurity')
  write_plist_if_changed(plist, path)
end

def patch_extension(project, root, ext)
  dir = File.join(root, ext[:name])
  FileUtils.mkdir_p(dir)
  copy_if_changed(File.join(RESOURCES, "#{ext[:name]}-Info.plist"), File.join(dir, 'Info.plist'))
  write_plist_if_changed(entitlements("#{ext[:name]}.entitlements", app: false, keychain: ext[:keychain]),
                         File.join(dir, "#{ext[:name]}.entitlements"))
  target = project.targets.find { |t| t.name == ext[:name] }
  if target
    fail!("target #{ext[:name]} exists but isn't an app extension") unless target.product_type == Xcodeproj::Constants::PRODUCT_TYPE_UTI[:app_extension]
  else
    target = project.new_target(:app_extension, ext[:name], :ios, DEPLOYMENT_TARGET, nil, :swift)
    drop_sdk_frameworks(project)
  end
  group = group_named(project.main_group, ext[:name])
  file_in(group, 'Info.plist')
  file_in(group, "#{ext[:name]}.entitlements")
  swift_sources(ext[:name]).each do |src|
    name = File.basename(src)
    copy_if_changed(src, File.join(dir, name))
    add_source(target, file_in(group, name))
  end
  target
end

# new_target links Foundation.framework by a path into one exact SDK (iPhoneOS26.0.sdk), which the next Xcode
# doesn't have. Swift links the system frameworks it imports by itself, so these references go.
def drop_sdk_frameworks(project)
  project.files.select { |f| f.source_tree == 'DEVELOPER_DIR' && f.path.to_s.include?('.sdk/') }.each(&:remove_from_project)
  frameworks = project.main_group.children.find { |c| c.display_name == 'Frameworks' && c.respond_to?(:groups) }
  return unless frameworks
  frameworks.groups.select { |g| g.children.empty? }.each(&:remove_from_project)
  frameworks.remove_from_project if frameworks.children.empty?
end

def patch_embed(app, ext_target)
  phase = app.copy_files_build_phases.find { |p| p.name == EMBED_PHASE } || app.new_copy_files_build_phase(EMBED_PHASE)
  phase.symbol_dst_subfolder_spec = :plug_ins
  phase.dst_path = ''
  product = ext_target.product_reference
  unless phase.files_references.include?(product)
    phase.add_file_reference(product, true).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  end
  app.add_dependency(ext_target) unless app.dependencies.any? { |d| d.target == ext_target }
end

def hearthkit_ref(project)
  refs = project.root_object.package_references
  ref = refs.find { |r| r.is_a?(Xcodeproj::Project::Object::XCLocalSwiftPackageReference) && r.relative_path == HEARTHKIT_PATH }
  return ref if ref
  fail!("#{HEARTHKIT_PATH} (from ios/App) has no Package.swift") unless File.exist?(File.join(MOBILE, 'ios-native/HearthKit/Package.swift'))
  ref = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
  ref.relative_path = HEARTHKIT_PATH
  refs << ref
  ref
end

def link_hearthkit(project, target, ref)
  dep = target.package_product_dependencies.find { |d| d.product_name == 'HearthKit' && d.package == ref }
  unless dep
    dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
    dep.product_name = 'HearthKit'
    dep.package = ref
    target.package_product_dependencies << dep
  end
  phase = target.frameworks_build_phase
  return if phase.files.any? { |f| f.product_ref == dep }
  file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  file.product_ref = dep
  phase.files << file
end

def conditions(config)
  base = config.name == 'Debug' ? ['DEBUG'] : []
  base << 'HEARTH_CUSTOM_SERVER' if custom_server?
  base.empty? ? '' : (['$(inherited)'] + base).join(' ')
end

def common_settings(config, entitlements_path, profile)
  s = config.build_settings
  s['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
  s['SWIFT_VERSION'] = '5.0'
  s['ENABLE_USER_SCRIPT_SANDBOXING'] = 'YES'
  s['CODE_SIGN_ENTITLEMENTS'] = entitlements_path
  s['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = conditions(config)
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['DEVELOPMENT_TEAM'] = team_id if team_id
  mv = marketing_version
  s['MARKETING_VERSION'] = mv if mv
  bn = build_number
  s['CURRENT_PROJECT_VERSION'] = bn if bn
  if profile && config.name == 'Release'
    s['CODE_SIGN_STYLE'] = 'Manual'
    s['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
    s['PROVISIONING_PROFILE_SPECIFIER'] = profile
  else
    s['CODE_SIGN_STYLE'] = 'Automatic'
    s.delete('PROVISIONING_PROFILE_SPECIFIER')
    s.delete('CODE_SIGN_IDENTITY')
  end
end

def patch_settings(project, app, ext_targets)
  project.build_configurations.each { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET }
  app.build_configurations.each do |c|
    common_settings(c, 'App/App.entitlements', profile_for('IOS_PROFILE_APP'))
  end
  # The extensions share the app's version: App Store validation refuses an extension whose version differs.
  versions = app.build_configurations.to_h { |c| [c.name, c.build_settings.values_at('MARKETING_VERSION', 'CURRENT_PROJECT_VERSION')] }
  EXTENSIONS.zip(ext_targets).each do |ext, t|
    t.build_configurations.each do |c|
      s = c.build_settings
      s['PRODUCT_NAME'] = '$(TARGET_NAME)'
      s['PRODUCT_BUNDLE_IDENTIFIER'] = ext[:bundle]
      s['INFOPLIST_FILE'] = "#{ext[:name]}/Info.plist"
      s['GENERATE_INFOPLIST_FILE'] = 'NO'
      s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
      s['SKIP_INSTALL'] = 'YES'
      s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
      common_settings(c, "#{ext[:name]}/#{ext[:name]}.entitlements", profile_for(ext[:profile]))
      s['MARKETING_VERSION'], s['CURRENT_PROJECT_VERSION'] = versions.fetch(c.name) { fail!("the App target has no #{c.name} configuration") }
    end
  end
end

def patch(ios)
  p = paths(ios)
  fail!("#{p[:project]} doesn't exist: run `npx cap add ios` first") unless File.directory?(p[:project])
  project = Xcodeproj::Project.open(p[:project])
  app = project.targets.find { |t| t.name == 'App' }
  fail!('no App target in the project') unless app
  group = patch_app_sources(project, app, p[:app])
  patch_ring(app, group, p[:app])
  patch_app_entitlements(group, p[:app])
  patch_app_plist(p[:app])
  ext_targets = EXTENSIONS.map { |ext| patch_extension(project, p[:root], ext) }
  ext_targets.each { |t| patch_embed(app, t) }
  ref = hearthkit_ref(project)
  [app, *ext_targets].each { |t| link_hearthkit(project, t, ref) }
  patch_settings(project, app, ext_targets)
  project.save
end

# ---------------------------------------------------------------------------------------------------- checking

def check_patched(ios)
  p = paths(ios)
  errors = []
  check = ->(ok, msg) { errors << msg unless ok }
  project = Xcodeproj::Project.open(p[:project])
  app = project.targets.find { |t| t.name == 'App' }
  return fail!('no App target') unless app

  # App sources: every ios-native/App file, as it is now, compiled into the app.
  app_sources = app.source_build_phase.files_references.map { |r| r.path && File.basename(r.path) }
  swift_sources('App').each do |src|
    name = File.basename(src)
    dest = File.join(p[:app], name)
    check.call(File.exist?(dest) && FileUtils.compare_file(src, dest), "ios/App/App/#{name} differs from ios-native/App/#{name}")
    check.call(app_sources.include?(name), "#{name} isn't in the App target's sources")
  end
  scene = File.read(File.join(p[:app], 'SceneDelegate.swift'))
  check.call(scene.include?('HearthViewController()') && !scene.include?('CAPBridgeViewController()'), 'SceneDelegate.swift must show HearthViewController')
  delegate = File.read(File.join(p[:app], 'AppDelegate.swift'))
  check.call(delegate.include?('@main') && !delegate.include?('@UIApplicationMain'), 'AppDelegate.swift must be the only entry point (@main)')
  check.call(delegate.include?('didRegisterForRemoteNotificationsWithDeviceToken'), "AppDelegate.swift doesn't pass on the push token")

  # The ring: in the app's bundle (iOS looks a notification's sound up there), 30 s or less.
  check.call(app.resources_build_phase.files_references.any? { |r| r.path == RING }, "#{RING} isn't in the App target's resources")
  ring = File.join(p[:app], RING)
  if File.exist?(ring)
    wav = File.binread(ring)
    rate = wav[28, 4].unpack1('V')
    data = wav.index('data') && wav[wav.index('data') + 4, 4].unpack1('V')
    check.call(wav.start_with?('RIFF') && rate.to_i.positive? && data && data.to_f / rate <= RING_MAX_SECONDS, "#{RING} must be a WAV file of #{RING_MAX_SECONDS} s or less")
  else
    errors << "ios/App/App/#{RING} is missing"
  end

  # Info.plist
  plist = Xcodeproj::Plist.read_from_path(File.join(p[:app], 'Info.plist'))
  APP_PLIST.each { |k, v| check.call(plist[k] == v, "Info.plist #{k} should be #{v.inspect}, is #{plist[k].inspect}") }
  check.call(!plist.key?('NSAppTransportSecurity'), 'Info.plist must have no NSAppTransportSecurity exceptions')
  check.call(!plist.key?('NSPhotoLibraryAddUsageDescription'), 'Info.plist asks for Photos, which the app never uses')

  # Entitlements
  host = applinks_host(env('SERVER'))
  app_ent = File.join(p[:app], 'App.entitlements')
  if File.exist?(app_ent)
    e = Xcodeproj::Plist.read_from_path(app_ent)
    check.call(e['aps-environment'] == (manual_signing? ? 'production' : 'development'), 'App.entitlements aps-environment')
    check.call(e['com.apple.developer.usernotifications.time-sensitive'] == true, 'App.entitlements: no Time Sensitive notifications (call rings)')
    check.call(e['com.apple.security.application-groups'] == [APP_GROUP], 'App.entitlements: the App Group')
    check.call(e['keychain-access-groups']&.first == KEYCHAIN_GROUP, 'App.entitlements: the Keychain group must come first')
    check.call(e['com.apple.developer.associated-domains'] == (host && ["applinks:#{host}"]), "App.entitlements associated domains should be #{host ? "applinks:#{host}" : 'absent'}")
  else
    errors << 'ios/App/App/App.entitlements is missing'
  end

  # The extensions: built, embedded in the app, with their Info.plist, entitlements and sources.
  embed = app.copy_files_build_phases.find { |ph| ph.name == EMBED_PHASE }
  check.call(embed && embed.symbol_dst_subfolder_spec == :plug_ins, "the App target has no #{EMBED_PHASE} phase into PlugIns")
  ext_targets = EXTENSIONS.map do |ext|
    t = project.targets.find { |x| x.name == ext[:name] }
    unless t
      errors << "no #{ext[:name]} target"
      next nil
    end
    dir = File.join(p[:root], ext[:name])
    check.call(t.product_type == Xcodeproj::Constants::PRODUCT_TYPE_UTI[:app_extension], "#{ext[:name]} isn't an app extension")
    check.call(embed && embed.files_references.include?(t.product_reference), "#{ext[:name]} isn't embedded in the app")
    check.call(app.dependencies.any? { |d| d.target == t }, "the App target doesn't build #{ext[:name]}")
    info = File.exist?(File.join(dir, 'Info.plist')) ? Xcodeproj::Plist.read_from_path(File.join(dir, 'Info.plist')) : {}
    nsext = info['NSExtension'] || {}
    check.call(nsext['NSExtensionPointIdentifier'] == ext[:point], "#{ext[:name]}/Info.plist NSExtensionPointIdentifier")
    check.call(nsext['NSExtensionPrincipalClass'] == ext[:principal], "#{ext[:name]}/Info.plist NSExtensionPrincipalClass")
    check.call(info['CFBundleShortVersionString'] == '$(MARKETING_VERSION)' && info['CFBundleVersion'] == '$(CURRENT_PROJECT_VERSION)', "#{ext[:name]}/Info.plist must take the version from the build settings")
    if ext[:name] == 'ShareExtension'
      rule = nsext.dig('NSExtensionAttributes', 'NSExtensionActivationRule')
      check.call(rule == { 'NSExtensionActivationSupportsWebURLWithMaxCount' => 1, 'NSExtensionActivationSupportsText' => true }, 'ShareExtension activation rule')
    end
    ent_path = File.join(dir, "#{ext[:name]}.entitlements")
    ent = File.exist?(ent_path) ? Xcodeproj::Plist.read_from_path(ent_path) : {}
    check.call(ent['com.apple.security.application-groups'] == [APP_GROUP], "#{ext[:name]}.entitlements: the App Group")
    check.call(!ext[:keychain] || ent['keychain-access-groups']&.first == KEYCHAIN_GROUP, "#{ext[:name]}.entitlements: the Keychain group")
    sources = t.source_build_phase.files_references.map { |r| r.path && File.basename(r.path) }
    swift_sources(ext[:name]).each do |src|
      name = File.basename(src)
      dest = File.join(dir, name)
      check.call(File.exist?(dest) && FileUtils.compare_file(src, dest), "ios/App/#{ext[:name]}/#{name} differs from ios-native/#{ext[:name]}/#{name}")
      check.call(sources.include?(name), "#{name} isn't in the #{ext[:name]} target's sources")
    end
    t
  end

  check.call(project.files.none? { |f| f.path.to_s.include?('.sdk/') }, 'the project links a file inside one exact SDK')

  # HearthKit, linked into all three.
  ref = project.root_object.package_references.find { |r| r.respond_to?(:relative_path) && r.relative_path == HEARTHKIT_PATH }
  check.call(ref, "the project doesn't reference the HearthKit package at #{HEARTHKIT_PATH}")
  [app, *ext_targets.compact].each do |t|
    dep = t.package_product_dependencies.find { |d| d.product_name == 'HearthKit' && d.package == ref }
    check.call(dep && t.frameworks_build_phase.files.any? { |f| f.product_ref == dep }, "#{t.name} doesn't link HearthKit")
  end

  # Nothing in the project runs at build time: ios-archive signs the project another job made, with the App Store
  # Connect key on the runner. No script phases or build rules, no tool swapped through a build setting, no .xcconfig
  # for a Release build, and in CapApp-SPM only Capacitor's own package and the keyboard plugin.
  project.targets.each do |t|
    check.call(t.build_phases.none? { |ph| ph.is_a?(Xcodeproj::Project::Object::PBXShellScriptBuildPhase) }, "#{t.name} has a script build phase")
    check.call(!t.respond_to?(:build_rules) || t.build_rules.empty?, "#{t.name} has build rules")
  end
  [project, *project.targets].each do |owner|
    owner.build_configurations.each do |c|
      where = "#{owner.respond_to?(:name) && owner.name ? owner.name : 'project'} #{c.name}"
      tools = c.build_settings.keys.grep(/\A(CC|CPLUSPLUS|CXX|LD|LDPLUSPLUS|LIBTOOL|SWIFT_DRIVER)\z|_EXEC\z|PLUGIN/)
      check.call(tools.empty?, "#{where}: build settings that swap a tool: #{tools.join(', ')}")
      check.call(c.name != 'Release' || c.base_configuration_reference.nil?, "#{where}: a Release build takes no .xcconfig")
    end
  end
  spm = File.join(p[:root], 'CapApp-SPM', 'Package.swift')
  if File.exist?(spm)
    pkg = File.read(spm)
    deps = pkg.scan(/\.package\(([^)]*)\)/).flatten.map { |d| d.gsub(/\s+/, ' ').strip }
    check.call(deps.size == 2 &&
               deps.one? { |d| d =~ %r{\Aurl: "https://github\.com/ionic-team/capacitor-swift-pm\.git", exact: "[\d.]+"\z} } &&
               deps.include?('name: "CapacitorKeyboard", path: "../../../node_modules/@capacitor/keyboard"'),
               "CapApp-SPM/Package.swift depends on something besides Capacitor and the keyboard plugin: #{deps.inspect}")
    check.call(pkg !~ /plugin|unsafeFlags|binaryTarget|Process|import (?!PackageDescription\b)/, 'CapApp-SPM/Package.swift does more than list its packages')
  else
    errors << 'ios/App/CapApp-SPM/Package.swift is missing'
  end

  # Build settings
  versions = []
  [[app, 'App/App.entitlements', 'IOS_PROFILE_APP', 'app.hearth.mobile'],
   *EXTENSIONS.zip(ext_targets).select { |_, t| t }.map { |e, t| [t, "#{e[:name]}/#{e[:name]}.entitlements", e[:profile], e[:bundle]] }].each do |t, ent, prof, bundle|
    t.build_configurations.each do |c|
      s = c.build_settings
      where = "#{t.name} #{c.name}"
      check.call(s['PRODUCT_BUNDLE_IDENTIFIER'] == bundle, "#{where}: bundle ID #{bundle}")
      check.call(s['IPHONEOS_DEPLOYMENT_TARGET'] == DEPLOYMENT_TARGET, "#{where}: iOS #{DEPLOYMENT_TARGET}")
      check.call(s['SWIFT_VERSION'] == '5.0', "#{where}: Swift 5")
      check.call(s['ENABLE_USER_SCRIPT_SANDBOXING'] == 'YES', "#{where}: user script sandboxing")
      check.call(s['CODE_SIGN_ENTITLEMENTS'] == ent && File.exist?(File.join(p[:root], ent)), "#{where}: entitlements #{ent}")
      cond = s['SWIFT_ACTIVE_COMPILATION_CONDITIONS'].to_s.split
      check.call(cond.include?('DEBUG') == (c.name == 'Debug'), "#{where}: DEBUG only in Debug")
      check.call(cond.include?('HEARTH_CUSTOM_SERVER') == custom_server?, "#{where}: HEARTH_CUSTOM_SERVER only when asked for")
      check.call(!team_id || s['DEVELOPMENT_TEAM'] == team_id, "#{where}: team #{team_id}")
      manual = profile_for(prof) && c.name == 'Release'
      check.call(s['CODE_SIGN_STYLE'] == (manual ? 'Manual' : 'Automatic'), "#{where}: #{manual ? 'manual' : 'automatic'} signing")
      check.call(!manual || s['PROVISIONING_PROFILE_SPECIFIER'] == profile_for(prof), "#{where}: provisioning profile")
      check.call(!marketing_version || s['MARKETING_VERSION'] == marketing_version, "#{where}: version #{marketing_version}")
      check.call(!build_number || s['CURRENT_PROJECT_VERSION'] == build_number, "#{where}: build #{build_number}")
      if t != app
        check.call(s['APPLICATION_EXTENSION_API_ONLY'] == 'YES', "#{where}: extension-safe API only")
        check.call(s['INFOPLIST_FILE'] == "#{t.name}/Info.plist", "#{where}: Info.plist")
      end
      versions << [c.name, s['MARKETING_VERSION'], s['CURRENT_PROJECT_VERSION']]
    end
  end
  check.call(versions.uniq.size == versions.map(&:first).uniq.size, "the app and its extensions must have the same version and build: #{versions.uniq.inspect}")

  return if errors.empty?
  warn "patch-ios: the project isn't patched as expected:\n  #{errors.join("\n  ")}"
  exit 1
end

if $PROGRAM_NAME == __FILE__
  args = ARGV.dup
  only_check = args.delete('--check')
  fail!('usage: patch-ios.rb [--check] <ios folder>') unless args.size == 1
  ios = File.expand_path(args.first)
  patch(ios) unless only_check
  check_patched(ios)
  puts "patch-ios: #{File.basename(ios)}/ is #{only_check ? 'patched as expected' : 'patched'}"
end
