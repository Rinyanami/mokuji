package app.mokuji.reader;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Pattern;

final class ServerAddress {
    private static final Pattern IPV4 = Pattern.compile("(?:0|[1-9][0-9]{0,2})(?:\\.(?:0|[1-9][0-9]{0,2})){3}");
    private static final Pattern DOMAIN = Pattern.compile(
        "(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?");
    private static boolean privateAddress(String host) {
        if (!IPV4.matcher(host).matches()) return false;
        String[] parts = host.split("\\.");
        int a = Integer.parseInt(parts[0]), b = Integer.parseInt(parts[1]);
        for (String p : parts) if (Integer.parseInt(p) > 255) return false;
        return a == 10 || a == 192 && b == 168 || a == 172 && b >= 16 && b <= 31;
    }

    static String normalize(String input) {
        String text = input == null ? "" : input.trim();
        if (text.isEmpty() || text.length() > 2048 || text.indexOf('\\') >= 0)
            throw new IllegalArgumentException("请填写电脑「手机连接」显示的地址，或服务器的 HTTPS 网址。");
        if (!text.contains("://")) {
            String host = text.split("[:/#?]", 2)[0];
            text = (privateAddress(host) ? "http://" : "https://") + text;
        }
        try {
            URI uri = new URI(text);
            String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            if (host == null || uri.getRawUserInfo() != null || uri.getPort() == 0 || uri.getPort() > 65535
                    || uri.getRawAuthority().endsWith(":")) throw new URISyntaxException(text, "authority");
            host = host.toLowerCase(Locale.ROOT);
            if (host.equals("localhost") || host.startsWith("127.") || host.equals("[::1]"))
                throw new IllegalArgumentException("手机上的本机地址指向手机自己，请使用电脑「手机连接」里的局域网地址。");
            if (!scheme.equals("https") && !(scheme.equals("http") && privateAddress(host)))
                throw new IllegalArgumentException("公网服务器请使用 HTTPS；家中电脑可使用手机连接页显示的 HTTP 局域网地址。");
            if (!privateAddress(host) && !DOMAIN.matcher(host).matches()) {
                if (IPV4.matcher(host).matches()) {
                    for (String octet : host.split("\\.")) if (Integer.parseInt(octet) > 255) throw new URISyntaxException(text, "ip");
                } else if (!(host.startsWith("[") && host.endsWith("]") && host.indexOf('%') < 0)) throw new URISyntaxException(text, "host");
            }
            String path = uri.getRawPath();
            if (uri.getRawQuery() != null || !(path.isEmpty() || path.equals("/") || path.equals("/pair") || path.equals("/index.html")))
                throw new IllegalArgumentException("请填写目次首页或配对页面的网址。");
            return new URI(scheme, null, host, uri.getPort(), null, null, null).toASCIIString();
        } catch (URISyntaxException err) {
            throw new IllegalArgumentException("地址格式有误，请复制完整的目次网址。");
        }
    }
}
