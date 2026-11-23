import Foundation

struct ServerAddress: Equatable {
    let origin: URL

    init?(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 2048,
              !text.contains("\\"), text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              var parts = URLComponents(string: text),
              let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil,
              ["/", "", "/pair", "/index.html"].contains(parts.path),
              parts.query == nil,
              parts.port.map({ (1...65535).contains($0) }) ?? true else { return nil }
        let normalizedHost = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        guard !["localhost", "::1", "0.0.0.0", "::"].contains(normalizedHost),
              !host.hasSuffix(".localhost"), !host.hasPrefix("127.") else { return nil }
        if scheme == "http" && !Self.privateIPv4(host) { return nil }
        parts.scheme = scheme
        parts.host = host
        parts.path = "/"
        parts.fragment = nil
        guard let address = parts.url else { return nil }
        origin = address
    }

    func matches(_ url: URL) -> Bool {
        guard let first = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              let second = URLComponents(url: url, resolvingAgainstBaseURL: false),
              second.user == nil, second.password == nil else { return false }
        let defaultPort = first.scheme == "https" ? 443 : 80
        return first.scheme?.lowercased() == second.scheme?.lowercased()
            && first.host?.lowercased() == second.host?.lowercased()
            && (first.port ?? defaultPort) == (second.port ?? defaultPort)
    }

    var readerURL: URL {
        var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        parts.fragment = "/webfiction"
        return parts.url!
    }

    private static func privateIPv4(_ host: String) -> Bool {
        let fields = host.split(separator: ".", omittingEmptySubsequences: false)
        let bytes = fields.compactMap { value -> Int? in
            guard !value.isEmpty, value.count <= 3,
                  value.allSatisfy({ $0 >= "0" && $0 <= "9" }),
                  let number = Int(value), number <= 255, String(number) == String(value)
            else { return nil }
            return number
        }
        guard fields.count == 4, bytes.count == 4 else { return false }
        return bytes[0] == 10 || (bytes[0] == 172 && (16...31).contains(bytes[1]))
            || (bytes[0] == 192 && bytes[1] == 168)
    }
}
