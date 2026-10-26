import SwiftUI
import UIKit
import WebKit
import RoomPlan
import AVFoundation
import simd

@main
struct DomiraRoomPlanApp: App {
    var body: some Scene { WindowGroup { DomiraWebView().ignoresSafeArea() } }
}

struct DomiraWebView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebHostController { WebHostController() }
    func updateUIViewController(_ controller: WebHostController, context: Context) {}
}

final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

final class WebHostController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private let allowedHost = "domira.jiaxun-chen1218.workers.dev"
    private var webView: WKWebView!
    private var scanning = false

    override func viewDidLoad() {
        super.viewDidLoad()
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.userContentController.add(WeakScriptHandler(self), name: "domiraRoomPlan")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        webView.load(URLRequest(url: URL(string: "https://\(allowedHost)/")!))
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "https", url.host == allowedHost { decisionHandler(.allow) }
        else {
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated,
               ["https", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "domiraRoomPlan", message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == allowedHost,
              message.frameInfo.securityOrigin.protocol == "https",
              let body = message.body as? [String: Any], body["type"] as? String == "scan",
              let requestID = body["requestId"] as? String, UUID(uuidString: requestID) != nil else { return }
        guard !scanning else { return }
        guard RoomCaptureSession.isSupported else {
            deliver(requestID, error: "此裝置不支援 RoomPlan。需要具備 LiDAR 的 iPhone／iPad；仍可手動測量或匯入 JSON。")
            return
        }
        scanning = true
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard granted else { self.scanning = false; self.deliver(requestID, error: "未取得原生攝像頭權限。"); return }
                let scanner = RoomScannerController()
                scanner.modalPresentationStyle = .fullScreen
                scanner.completion = { [weak self, weak scanner] payload, error in
                    scanner?.dismiss(animated: true) {
                        self?.scanning = false
                        self?.deliver(requestID, payload: payload, error: error)
                    }
                }
                self.present(scanner, animated: true)
            }
        }
    }

    private func deliver(_ requestID: String, payload: [String: Any]? = nil, error: String? = nil) {
        var result: [String: Any] = ["requestId": requestID]
        if let payload = payload { result["payload"] = payload }
        if let error = error { result["error"] = error }
        guard let bytes = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: bytes, encoding: .utf8) else { return }
        // JSONSerialization escapes all strings. No scanned value becomes executable JavaScript.
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('domira:roomplan', {detail: \(json)}));")
    }
}

final class RoomScannerController: UIViewController, RoomCaptureViewDelegate {
    var completion: (([String: Any]?, String?) -> Void)?
    private var captureView: RoomCaptureView!
    private var completed = false
    private var finishing = false
    private var savedPayload: [String: Any]?
    private let status = UILabel()
    private let finish = UIButton(type: .system)
    private let share = UIButton(type: .system)
    private let apply = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        captureView = RoomCaptureView(frame: view.bounds)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.delegate = self
        view.addSubview(captureView)
        let cancel = UIButton(type: .system)
        cancel.setTitle("取消", for: .normal)
        cancel.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)
        finish.setTitle("完成掃描", for: .normal)
        finish.addTarget(self, action: #selector(finishScan), for: .touchUpInside)
        share.setTitle("分享 JSON", for: .normal)
        share.addTarget(self, action: #selector(shareJSON), for: .touchUpInside)
        share.isHidden = true
        apply.setTitle("回填網頁", for: .normal)
        apply.addTarget(self, action: #selector(applyRoom), for: .touchUpInside)
        apply.isHidden = true
        status.text = "緩慢掃描牆角、門窗與地面；完成後核對尺寸。"
        status.textColor = .white
        status.font = .systemFont(ofSize: 13)
        status.numberOfLines = 0
        let buttons = UIStackView(arrangedSubviews: [cancel, finish, share, apply])
        buttons.distribution = .fillEqually
        let panel = UIStackView(arrangedSubviews: [status, buttons])
        panel.axis = .vertical
        panel.spacing = 12
        panel.backgroundColor = UIColor.black.withAlphaComponent(0.8)
        panel.isLayoutMarginsRelativeArrangement = true
        panel.layoutMargins = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        panel.layer.cornerRadius = 14
        panel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(panel)
        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            panel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            panel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !finishing { captureView.captureSession.run(configuration: RoomCaptureSession.Configuration()) }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if !finishing { captureView.captureSession.stop() }
    }
    @objc private func cancelScan() {
        guard !completed else { return }
        completed = true
        captureView.captureSession.stop()
        completion?(nil, "原生掃描已取消，未變更網頁設計。")
    }
    @objc private func finishScan() {
        finishing = true
        finish.isEnabled = false
        status.text = "正在處理 RoomPlan 掃描結果…"
        captureView.captureSession.stop()
    }
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        if let error = error { fail(error.localizedDescription); return false }
        return !completed
    }
    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        DispatchQueue.main.async { [weak self] in self?.process(processedResult, error: error) }
    }
    private func process(_ processedResult: CapturedRoom, error: Error?) {
        guard !completed else { return }
        if let error = error { fail(error.localizedDescription); return }
        guard processedResult.walls.count >= 3 else { fail("至少需要三面牆。請重新掃描完整房間。"); return }
        let walls: [[String: Any]] = processedResult.walls.map { wall in
            let matrix = wall.transform
            let columns = [matrix.columns.0, matrix.columns.1, matrix.columns.2, matrix.columns.3]
            let values: [Double] = columns.flatMap { [Double($0.x), Double($0.y), Double($0.z), Double($0.w)] }
            return ["id": wall.identifier.uuidString,
                    "dimensions": [Double(wall.dimensions.x), Double(wall.dimensions.y), Double(wall.dimensions.z)],
                    "transform": values, "confidence": String(describing: wall.confidence)]
        }
        savedPayload = ["format": "domira.roomplan.v1", "units": "m",
                        "capturedAt": ISO8601DateFormatter().string(from: Date()), "walls": walls]
        status.text = "已取得 \(walls.count) 面牆。可回填網頁確認尺寸，或分享 JSON 後於 Safari 匯入。網頁使用包絡矩形地板，非完整網格重建。"
        finish.isHidden = true
        share.isHidden = false
        apply.isHidden = false
    }
    @objc private func applyRoom() {
        guard !completed, let payload = savedPayload else { return }
        completed = true
        completion?(payload, nil)
    }
    @objc private func shareJSON() {
        guard let payload = savedPayload else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("Domira-RoomPlan-\(UUID().uuidString).json")
            try data.write(to: url, options: .atomic)
            let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            activity.popoverPresentationController?.sourceView = share
            activity.popoverPresentationController?.sourceRect = share.bounds
            present(activity, animated: true)
        } catch { status.text = "無法匯出測量結果：\(error.localizedDescription)" }
    }
    private func fail(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.completed else { return }
            self.completed = true
            self.completion?(nil, message)
        }
    }
}
