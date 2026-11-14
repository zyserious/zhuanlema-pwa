import Foundation
import Security

/// 服务端 /api/today 的返回。只声明这个 App 用得到的字段，
/// 服务端加字段不会让解码失败。
struct TodayPayload: Decodable {
    let status: String
    let shift: String
    let shiftName: String
    let shiftEmoji: String
    let windowText: String
    let window: [Int]?
    let perSec: Double
    let earned: Double
    let dayTotal: Double
    let remainSec: Int
    let untilStartSec: Int
    let progress: Double
    let now: String
}

enum APIError: LocalizedError {
    case server(Int)
    case badData
    case message(String)

    var errorDescription: String? {
        switch self {
        case .server(let code): return "服务器返回 \(code)"
        case .badData: return "返回的数据看不懂"
        case .message(let m): return m
        }
    }
}

enum API {
    static let base = URL(string: "https://xyt.zyserious.xyz")!

    static func login(_ user: String, _ pass: String) async throws -> String {
        var req = URLRequest(url: base.appendingPathComponent("api/login"))
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["username": user, "password": pass])

        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? -1

        struct Reply: Decodable {
            let ok: Bool?
            let token: String?
            let error: String?
        }
        if let r = try? JSONDecoder().decode(Reply.self, from: data), let t = r.token, !t.isEmpty {
            return t
        }
        if let r = try? JSONDecoder().decode(Reply.self, from: data), let e = r.error {
            throw APIError.message(e)
        }
        throw APIError.server(code)
    }

    static func today(_ token: String) async throws -> TodayPayload {
        var req = URLRequest(url: base.appendingPathComponent("api/today"))
        req.timeoutInterval = 15
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let code = (resp as? HTTPURLResponse)?.statusCode else { throw APIError.badData }
        if code == 401 { throw APIError.message("登录过期了，重新登录一次") }
        guard code == 200 else { throw APIError.server(code) }
        guard let p = try? JSONDecoder().decode(TodayPayload.self, from: data) else {
            throw APIError.badData
        }
        return p
    }
}

enum Keychain {
    private static let service = "xyz.zyserious.zhuanlema"

    static func save(_ value: String, for key: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let d = item as? Data,
              let s = String(data: d, encoding: .utf8), !s.isEmpty else { return nil }
        return s
    }

    static func delete(_ key: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(q as CFDictionary)
    }
}
