package app.hearth.mobile;

import java.net.URI;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Links shared to the app (Share → Hearth, ACTION_SEND text/plain): the first TikTok or Instagram link in what was
 * shared, or null. Plain Java, tested on any JVM.
 *
 * Any app can send anything, so what's shared is untrusted: only an https link on TikTok's or Instagram's own names
 * is taken (no user name or password, no other port), and only that link travels on to the page, which checks it
 * again (public/js/share.js) and opens a picker. Nothing is sent anywhere until the person picks a conversation.
 */
final class ShareLinks {
    private ShareLinks() { }

    static final int TEXT_MAX = 8000;
    private static final Pattern URL = Pattern.compile("https?://[^\\s<>\"'`]{1,2048}", Pattern.CASE_INSENSITIVE);
    private static final Set<String> HOSTS = Set.of("tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
        "instagram.com", "www.instagram.com", "m.instagram.com");

    /** The first TikTok or Instagram link in the shared text (then its subject), or null. */
    static String extract(String text, String subject) {
        String found = first(text);
        return found != null ? found : first(subject);
    }

    static String first(String text) {
        if (text == null || text.isEmpty()) return null;
        String s = text.length() > TEXT_MAX ? text.substring(0, TEXT_MAX) : text;
        Matcher m = URL.matcher(s);
        while (m.find()) {
            String raw = trimTail(m.group());
            if (ok(raw)) return raw;
        }
        return null;
    }

    // Punctuation after a link isn't part of it; trimmed one character at a time (a regular expression for it took
    // time growing with the square of a long run of dots).
    static String trimTail(String s) {
        int end = s.length();
        while (end > 0 && ")].,;:!?'\"\u00bb\u201d".indexOf(s.charAt(end - 1)) >= 0) end--;
        return s.substring(0, end);
    }

    static boolean ok(String link) {
        URI u;
        try { u = new URI(link); } catch (Exception e) { return false; }
        if (!"https".equalsIgnoreCase(u.getScheme()) || u.getRawUserInfo() != null || u.getPort() != -1 || u.getHost() == null) return false;
        String host = u.getHost().toLowerCase(Locale.ROOT);
        if (!HOSTS.contains(host)) return false;
        String path = u.getRawPath() == null ? "" : u.getRawPath();
        return path.length() > 1 && path.length() <= 300 && path.matches("[A-Za-z0-9/@._-]+");
    }
}
