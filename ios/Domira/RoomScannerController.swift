import UIKit
import RoomPlan
import simd

final class RoomScannerController: UIViewController, RoomCaptureViewDelegate {
    var completion: (([String: Any]?, String?) -> Void)?
    private let capture = RoomCaptureView(frame: .zero)
    private var finished = false
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        capture.delegate = self
        capture.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(capture)
        let controls = UIStackView()
        controls.axis = .horizontal; controls.distribution = .equalSpacing
        controls.translatesAutoresizingMaskIntoConstraints = false
        let cancel = UIButton(type: .system); cancel.setTitle("取消", for: .normal)
        cancel.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)
        let done = UIButton(type: .system); done.setTitle("完成掃描", for: .normal)
        done.addTarget(self, action: #selector(finishScan), for: .touchUpInside)
        controls.addArrangedSubview(cancel); controls.addArrangedSubview(done)
        view.addSubview(controls)
        NSLayoutConstraint.activate([
            capture.topAnchor.constraint(equalTo: view.topAnchor), capture.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            capture.leadingAnchor.constraint(equalTo: view.leadingAnchor), capture.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controls.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            controls.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24), controls.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)
        ])
        capture.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }
    @objc private func cancelScan() { capture.captureSession.stop(); finish(nil, "已取消原生掃描。") }
    @objc private func finishScan() { capture.captureSession.stop() }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); capture.captureSession.stop() }
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        if let error { finish(nil, error.localizedDescription); return false }
        return !finished
    }
    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error { finish(nil, error.localizedDescription); return }
        let walls: [[String: Any]] = processedResult.walls.map { wall in
            let m = wall.transform
            let columns = [m.columns.0,m.columns.1,m.columns.2,m.columns.3]
            return ["dimensions": [wall.dimensions.x,wall.dimensions.y,wall.dimensions.z],
                    "transform": columns.flatMap { [$0.x,$0.y,$0.z,$0.w] }, "confidence": String(describing: wall.confidence)]
        }
        guard walls.count >= 3 else { finish(nil, "牆面不足三面，請重新掃描。"); return }
        finish(["format":"domira.roomplan.v1", "units":"m", "capturedAt":ISO8601DateFormatter().string(from: Date()), "walls":walls], nil)
    }
    private func finish(_ payload: [String: Any]?, _ error: String?) {
        guard !finished else { return }; finished = true
        dismiss(animated: true) { [completion] in completion?(payload,error) }
    }
}
