import UIKit
import WebKit
import RoomPlan

final class StudioController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private let host = "domira.jiaxun-chen1218.workers.dev"
    private var web: WKWebView!
    private var pendingScan: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // Handlers are held by a weak proxy so closing the view releases the camera/web view.
        config.userContentController.add(WeakHandler(self), name: "domiraRoomPlan")
        config.userContentController.add(WeakHandler(self), name: "domiraShare")
        let script = #"""
        async function shareExport(a) {
          try {
            const b=await (await fetch(a.href)).blob();
            if(b.size>20*1024*1024) throw new Error('檔案超過 20 MB，請使用網頁匯出。');
            const reader=new FileReader();
            reader.onload=()=>window.webkit.messageHandlers.domiraShare.postMessage({name:a.download,data:reader.result});
            reader.readAsDataURL(b);
          } catch(err) { alert(err.message); }
        }
        // Studio exports use detached anchors, whose events do not bubble to document.
        const originalAnchorClick=HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click=function() {
          if(this.hasAttribute('download') && this.href.startsWith('blob:')) { void shareExport(this); return; }
          return originalAnchorClick.call(this);
        };
        document.addEventListener('click', e => {
          const a=e.target.closest('a[download]');
          if(!a || !a.href.startsWith('blob:')) return;
          e.preventDefault(); void shareExport(a);
        },true);
        """#
        config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self
        web.isInspectable = false
        view = web
        web.load(URLRequest(url: URL(string: "https://" + host + "/")!))
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == host,
              message.frameInfo.securityOrigin.protocol == "https",
              let body = message.body as? [String: Any] else { return }
        if message.name == "domiraRoomPlan", body["type"] as? String == "scan",
           body["version"] as? Int == 1, let id = body["requestId"] as? String, id.count <= 100, pendingScan == nil {
            guard RoomCaptureSession.isSupported else { sendScan(id, error: "此裝置不支援 LiDAR RoomPlan，請改用攝像頭引導或實測尺寸。"); return }
            pendingScan = id
            let scanner = RoomScannerController()
            scanner.completion = { [weak self] payload, error in
                self?.pendingScan = nil
                self?.sendScan(id, payload: payload, error: error)
            }
            scanner.modalPresentationStyle = .fullScreen
            present(scanner, animated: true)
        } else if message.name == "domiraShare", let name = body["name"] as? String,
                  let value = body["data"] as? String, value.count < 29_000_000,
                  let comma = value.firstIndex(of: ","),
                  let data = Data(base64Encoded: String(value[value.index(after: comma)...])), data.count <= 20*1024*1024 {
            do {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let safeName = URL(fileURLWithPath: name).lastPathComponent
                let file = directory.appendingPathComponent(safeName.isEmpty ? "Domira.json" : safeName)
                try data.write(to: file)
                let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                share.popoverPresentationController?.sourceView = view
                share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
                share.completionWithItemsHandler = { _,_,_,_ in try? FileManager.default.removeItem(at: directory) }
                present(share, animated: true)
            } catch { showError("匯出失敗，請重試。") }
        }
    }
    private func sendScan(_ id: String, payload: [String: Any]? = nil, error: String? = nil) {
        var result: [String: Any] = ["requestId": id]
        if let payload { result["payload"] = payload }
        if let error { result["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('domira:roomplan',{detail:\(json)}));", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "https" && url.host == host { decisionHandler(.allow) }
        else { decisionHandler(.cancel); if ["https", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) } }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError("連線失敗，請檢查網絡並使用頂部重新載入。") }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "Domira", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() }); present(alert, animated: true)
    }
    private func showError(_ message: String) {
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "Domira", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default)); present(alert, animated: true)
    }
}
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { target?.userContentController(userContentController, didReceive: message) }
}
