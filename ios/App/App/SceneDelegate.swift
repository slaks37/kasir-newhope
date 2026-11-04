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
    override func capacitorDidLoad() { bridge?.registerPluginInstance(SecureSessionPlugin());bridge?.registerPluginInstance(FinancialDiskPlugin()) }
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

import SQLite3
@objc(FinancialDiskPlugin)
public class FinancialDiskPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FinancialDiskPlugin"
    public let jsName = "FinancialDisk"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "compareAndSet", returnType: CAPPluginReturnPromise)]
    private var db: OpaquePointer?
    private let lock = NSLock()
    private func sql(_ text: String) throws { if sqlite3_exec(db, text, nil, nil, nil) != SQLITE_OK { throw NSError(domain:"FinancialDisk",code:1) } }
    private func open() throws {
        if db != nil { return }
        let dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("NewHopeFinancial", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        var noBackup = URLResourceValues(); noBackup.isExcludedFromBackup = true; var protectedDir=dir; try protectedDir.setResourceValues(noBackup)
        if sqlite3_open_v2(dir.appendingPathComponent("journal.sqlite").path, &db, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) != SQLITE_OK { sqlite3_close(db);db=nil; throw NSError(domain:"FinancialDisk",code:2) }
        do { try sql("PRAGMA journal_mode=WAL");try sql("PRAGMA synchronous=FULL");try sql("CREATE TABLE IF NOT EXISTS journal(key TEXT PRIMARY KEY,value TEXT NOT NULL)");try sql("CREATE TABLE IF NOT EXISTS identity(id INTEGER PRIMARY KEY CHECK(id=1),device_id TEXT NOT NULL)");try sql("INSERT OR IGNORE INTO identity VALUES(1,'\(UUID().uuidString)')") } catch { sqlite3_close(db);db=nil;throw error }
    }
    private func statement(_ sql: String, _ args: [String]) throws -> OpaquePointer {
        var stmt: OpaquePointer?; guard sqlite3_prepare_v2(db,sql,-1,&stmt,nil)==SQLITE_OK,let s=stmt else {throw NSError(domain:"FinancialDisk",code:3)}
        for (i,value) in args.enumerated() { if sqlite3_bind_text(s,Int32(i+1),value,-1,unsafeBitCast(-1,to:sqlite3_destructor_type.self)) != SQLITE_OK {sqlite3_finalize(s);throw NSError(domain:"FinancialDisk",code:4)} };return s
    }
    @objc func load(_ call: CAPPluginCall) {
        lock.lock();defer {lock.unlock()}
        do { try open();let identity=try statement("SELECT device_id FROM identity WHERE id=1",[]);defer{sqlite3_finalize(identity)};guard sqlite3_step(identity)==SQLITE_ROW else {throw NSError(domain:"FinancialDisk",code:5)};let device=String(cString:sqlite3_column_text(identity,0))
            let rows=try statement("SELECT key,value FROM journal ORDER BY key",[]);defer{sqlite3_finalize(rows)};var entries:[[String:String]]=[];var result=sqlite3_step(rows)
            while result==SQLITE_ROW {entries.append(["key":String(cString:sqlite3_column_text(rows,0)),"value":String(cString:sqlite3_column_text(rows,1))]);result=sqlite3_step(rows)}
            guard result==SQLITE_DONE else {throw NSError(domain:"FinancialDisk",code:6)};call.resolve(["deviceId":device,"entries":entries])
        }catch{call.reject("NATIVE_FINANCIAL_STORAGE_UNAVAILABLE")}
    }
    @objc func compareAndSet(_ call: CAPPluginCall) {
        lock.lock();defer{lock.unlock()}
        let prefixes=["newhope_sync_queue_workspace:v2:","newhope_sync_quarantine_workspace:v2:","newhope_cash_outbox_workspace:v2:","newhope_refund_ack_workspace:v2:","newhope_inventory_outbox_v1_workspace:v2:","newhope_shift_close_v1_"]
        guard let key=call.getString("key"),key.count<1024,prefixes.contains(where:{key.hasPrefix($0)}) else {call.reject("INVALID_FINANCIAL_KEY");return}
        do {try open();try sql("BEGIN IMMEDIATE")
            do {let get=try statement("SELECT value FROM journal WHERE key=?",[key]);defer{sqlite3_finalize(get)};let result=sqlite3_step(get);guard result==SQLITE_ROW || result==SQLITE_DONE else {throw NSError(domain:"FinancialDisk",code:7)};let current:String? = result==SQLITE_ROW ? String(cString:sqlite3_column_text(get,0)):nil
                guard current==call.getString("expected") else {try sql("ROLLBACK");call.reject("FINANCIAL_STORAGE_CONFLICT");return}
                let value=call.getString("value");let change=try statement(value==nil ? "DELETE FROM journal WHERE key=?":"INSERT OR REPLACE INTO journal(key,value) VALUES(?,?)",value.map{[key,$0]} ?? [key]);defer{sqlite3_finalize(change)};guard sqlite3_step(change)==SQLITE_DONE else {throw NSError(domain:"FinancialDisk",code:8)};try sql("COMMIT");call.resolve()
            }catch{try? sql("ROLLBACK");throw error}
        }catch{call.reject("NATIVE_FINANCIAL_STORAGE_UNAVAILABLE")}
    }
}
