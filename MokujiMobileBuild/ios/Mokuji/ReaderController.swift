import UIKit
import WebKit

final class ReaderController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let storageKey = "MokujiServerOrigin"
    private var server: ServerAddress?
    private let webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore.default()
        return WKWebView(frame: .zero, configuration: configuration)
    }()
    private let toolbar = UIStackView()
    private let panel = UIStackView()
    private let headline = UILabel()
    private let detail = UILabel()
    private let retry = UIButton(type: .system)
    private let back = UIButton(type: .system)
    private let spin = UIActivityIndicatorView(style: .medium)
    private let accent = UIColor(red: 0.32, green: 0.45, blue: 0.38, alpha: 1)
    private var backObservation: NSKeyValueObservation?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        view.tintColor = accent
        buildLayout()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        backObservation = webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] browser, _ in
            self?.updateBackButton(browser)
        }
        if let value = UserDefaults.standard.string(forKey: storageKey), let saved = ServerAddress(value) {
            connect(saved)
        } else {
            showPanel("连接你的书架", "在电脑的「手机连接」中查看地址。部署到服务器后，也可以填写自己的 HTTPS 网址。")
        }
    }

    private func icon(_ button: UIButton, _ symbol: String, _ label: String, _ action: Selector) {
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.accessibilityLabel = label
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
    }

    private func buildLayout() {
        toolbar.axis = .horizontal
        toolbar.alignment = .center
        let title = UILabel()
        title.text = "目次 Mokuji"
        title.font = .preferredFont(forTextStyle: .headline)
        title.adjustsFontForContentSizeCategory = true
        title.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let refresh = UIButton(type: .system), settings = UIButton(type: .system)
        icon(back, "chevron.backward", "返回上一页", #selector(goBack))
        icon(refresh, "arrow.clockwise", "刷新书架", #selector(reloadPage))
        icon(settings, "slider.horizontal.3", "服务器地址", #selector(configure))
        for item in [back, title, spin, refresh, settings] { toolbar.addArrangedSubview(item) }

        panel.axis = .vertical
        panel.alignment = .center
        panel.spacing = 14
        headline.font = .preferredFont(forTextStyle: .title2)
        detail.font = .preferredFont(forTextStyle: .body)
        detail.textColor = .secondaryLabel
        for label in [headline, detail] {
            label.numberOfLines = 0
            label.adjustsFontForContentSizeCategory = true
            label.textAlignment = .center
            panel.addArrangedSubview(label)
        }
        let configureButton = UIButton(type: .system)
        var setupStyle = UIButton.Configuration.filled()
        setupStyle.title = "设置服务器地址"
        setupStyle.cornerStyle = .medium
        configureButton.configuration = setupStyle
        configureButton.addTarget(self, action: #selector(configure), for: .touchUpInside)
        retry.setTitle("重新连接", for: .normal)
        retry.addTarget(self, action: #selector(reloadPage), for: .touchUpInside)
        for item in [configureButton, retry] { panel.addArrangedSubview(item) }
        for item in [toolbar, webView, panel] {
            item.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(item)
        }
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: safe.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 46),
            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
            webView.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            panel.centerYAnchor.constraint(equalTo: webView.centerYAnchor),
            panel.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 26),
            panel.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -26)
        ])
    }

    private func showPanel(_ title: String, _ message: String) {
        spin.stopAnimating()
        headline.text = title
        detail.text = message
        webView.isHidden = true
        panel.isHidden = false
        retry.isHidden = server == nil
    }

    @objc private func configure() {
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "服务器地址", message: "粘贴电脑「手机连接」显示的 http:// 内网地址及端口，或填写部署好的 https:// 网址。", preferredStyle: .alert)
        alert.addTextField { [weak self] field in
            field.placeholder = "http://192.168.1.20:5199"
            field.text = self?.server?.origin.absoluteString
            field.keyboardType = .URL
            field.textContentType = .URL
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
            field.clearButtonMode = .whileEditing
        }
        let connectAction = UIAlertAction(title: "连接", style: .default) { [weak self, weak alert] _ in
            if let text = alert?.textFields?.first?.text, let address = ServerAddress(text) {
                self?.connect(address)
            }
        }
        if let field = alert.textFields?.first {
            connectAction.isEnabled = ServerAddress(field.text ?? "") != nil
            field.addAction(UIAction { [weak field, weak connectAction] _ in
                connectAction?.isEnabled = ServerAddress(field?.text ?? "") != nil
            }, for: .editingChanged)
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(connectAction)
        present(alert, animated: true)
    }

    private func connect(_ address: ServerAddress) {
        let switched = server != address
        server = address
        UserDefaults.standard.set(address.origin.absoluteString, forKey: storageKey)
        if switched { webView.stopLoading() }
        panel.isHidden = true
        webView.isHidden = false
        webView.load(URLRequest(url: address.readerURL))
    }

    @objc private func reloadPage() {
        guard let server else { configure(); return }
        panel.isHidden = true
        webView.isHidden = false
        if let url = webView.url, server.matches(url) { webView.reload() }
        else { webView.load(URLRequest(url: server.readerURL)) }
    }

    private func updateBackButton(_ browser: WKWebView) {
        back.isEnabled = browser.backForwardList.backItem.map { server?.matches($0.url) == true } ?? false
    }

    @objc private func goBack() {
        guard let previous = webView.backForwardList.backItem, server?.matches(previous.url) == true else { return }
        webView.go(to: previous)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { spin.startAnimating() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { spin.stopAnimating(); updateBackButton(webView) }

    private func failed(_ error: Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return }
        showPanel("暂时连不上目次", "请检查服务器地址。局域网模式需要手机与电脑连同一个 Wi-Fi，并允许目次访问本地网络。\n\n" + error.localizedDescription)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { showPanel("阅读页面已关闭", "点「重新连接」打开书架。") }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if server?.matches(url) == true {
            if navigationAction.targetFrame == nil {
                decisionHandler(.cancel)
                webView.load(navigationAction.request)
            } else { decisionHandler(.allow) }
            return
        }
        decisionHandler(.cancel)
        if navigationAction.navigationType == .linkActivated,
           ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
           url.user == nil, url.password == nil {
            UIApplication.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let origin = frame.request.url, server?.matches(origin) == true, frame.isMainFrame,
              presentedViewController == nil else { completionHandler(false); return }
        let alert = UIAlertController(title: "目次", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodHTTPBasic else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        guard let origin = server?.origin, origin.scheme == "https",
              space.host.lowercased() == origin.host?.lowercased(),
              space.port == (origin.port ?? 443), presentedViewController == nil else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        let alert = UIAlertController(title: "登录目次服务器", message: space.host, preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "用户名"; $0.textContentType = .username; $0.autocapitalizationType = .none }
        alert.addTextField { $0.placeholder = "密码"; $0.isSecureTextEntry = true; $0.textContentType = .password }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(.cancelAuthenticationChallenge, nil) })
        alert.addAction(UIAlertAction(title: "登录", style: .default) { [weak alert] _ in
            let fields = alert?.textFields
            let user = fields?.first?.text ?? ""
            let password = fields?.last?.text ?? ""
            completionHandler(.useCredential, URLCredential(user: user, password: password, persistence: .forSession))
        })
        present(alert, animated: true)
    }
}
