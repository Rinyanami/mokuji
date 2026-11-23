import SwiftUI

@main
struct MokujiApp: App {
    var body: some Scene {
        WindowGroup { ReaderHost().ignoresSafeArea() }
    }
}

private struct ReaderHost: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> ReaderController { ReaderController() }
    func updateUIViewController(_ controller: ReaderController, context: Context) {}
}
