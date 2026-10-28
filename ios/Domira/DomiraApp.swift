import SwiftUI
import WebKit

@main
struct DomiraApp: App {
    var body: some Scene { WindowGroup { StudioView().preferredColorScheme(.dark) } }
}
struct StudioView: View {
    @State private var reloadID = UUID()
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("DOMIRA").font(.headline).tracking(3)
                Spacer()
                Button("重新載入", systemImage: "arrow.clockwise") { reloadID = UUID() }
                    .accessibilityHint("重新連線工作室；未儲存的操作可能遺失")
            }.padding().background(Color(red: 0.03, green: 0.04, blue: 0.07))
            StudioWebView().id(reloadID)
        }
    }
}
struct StudioWebView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> StudioController { StudioController() }
    func updateUIViewController(_ controller: StudioController, context: Context) {}
}
