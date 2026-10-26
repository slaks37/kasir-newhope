import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MerchantBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

import Security
class MerchantBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(SecureSessionPlugin()) }
}
@objc(SecureSessionPlugin)
public class SecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureSessionPlugin"
    public let jsName = "SecureSession"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)]
    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), key.range(of: "^sb-[a-zA-Z0-9-]+-auth-token(-code-verifier|-user)?$", options: .regularExpression) != nil else { call.reject("INVALID_SESSION_KEY"); return nil }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "space.newhope.kasir.session", kSecAttrAccount as String: key, kSecAttrSynchronizable as String: false]
    }
    @objc func get(_ call: CAPPluginCall) {
        guard var q = query(call) else { return }; q[kSecReturnData as String] = true
        var item: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else { call.reject("SECURE_SESSION_UNAVAILABLE"); return }
        call.resolve(["value": value])
    }
    @objc func set(_ call: CAPPluginCall) {
        guard let q = query(call), let value = call.getString("value") else { return }
        let attrs: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound { status = SecItemAdd(q.merging(attrs) { _, n in n } as CFDictionary, nil) }
        if status == errSecSuccess { call.resolve() } else { call.reject("SECURE_SESSION_UNAVAILABLE") }
    }
    @objc func remove(_ call: CAPPluginCall) {
        guard let q = query(call) else { return }; let status = SecItemDelete(q as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { call.resolve() } else { call.reject("SECURE_SESSION_UNAVAILABLE") }
    }
}
