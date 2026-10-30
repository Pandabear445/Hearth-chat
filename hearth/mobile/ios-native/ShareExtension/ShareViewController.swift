import UIKit
import UniformTypeIdentifiers
import HearthKit

/// Share → Hearth from another app (TikTok, Instagram, Safari): the iPhone side of MainActivity's ACTION_SEND.
/// Only a TikTok or Instagram link goes on (ShareLinks, as on Android). It's left in the App Group's defaults
/// ("pendingShare") and the app picks it up the next time it comes on screen (LinkRouter), where the page's share
/// picker opens; nothing is sent until a conversation is picked. A share extension can't open its app through any
/// supported API, so it says to open Hearth.
/// Info.plist: NSExtensionPrincipalClass "ShareViewController" (the @objc name below), no storyboard.
@objc(ShareViewController)
final class ShareViewController: UIViewController {
    private let card = UIView()
    private let label = UILabel()
    private let button = UIButton(type: .system)
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 14
        card.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .body)
        label.text = "Reading the link\u{2026}"
        label.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle("OK", for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.isHidden = true
        button.addTarget(self, action: #selector(done), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)
        card.addSubview(label)
        card.addSubview(button)
        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 320),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            card.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
            label.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
            label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            button.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 12),
            button.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            button.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
        ])
        read()
    }

    // The first link offered, else the first text (TikTok and Instagram share their link as text, with a caption).
    private func read() {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let subject = items.first?.attributedContentText?.string
        let providers = items.flatMap { $0.attachments ?? [] }
        let url = UTType.url.identifier
        let text = UTType.plainText.identifier
        let type = providers.contains { $0.hasItemConformingToTypeIdentifier(url) } ? url : text
        guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(type) }) else {
            show(nil, subject: subject)
            return
        }
        provider.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
            var found: String?
            if let u = item as? URL { found = u.absoluteString }
            else if let s = item as? String { found = s }
            else if let d = item as? Data { found = String(data: d.prefix(ShareLinks.textMax * 4), encoding: .utf8) }
            let shared = found.map { String($0.prefix(ShareLinks.textMax)) }
            DispatchQueue.main.async { self.show(shared, subject: subject) }
        }
    }

    private func show(_ text: String?, subject: String?) {
        if let link = ShareLinks.extract(text: text, subject: subject) {
            UserDefaults(suiteName: DeviceKeys.appGroup)?.set(link, forKey: "pendingShare")
            label.text = "Open Hearth to share this link. It will be waiting there."
        } else {
            label.text = "Hearth takes links to TikTok videos and Instagram reels and posts."
        }
        button.isHidden = false
    }

    @objc private func done() {
        guard !finished else { return }
        finished = true
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
