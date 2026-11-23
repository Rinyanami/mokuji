using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MokujiDesktop
{
    static class NativeMethods
    {
        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll")]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr LoadLibrary(string lpFileName);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern bool DestroyIcon(IntPtr handle);

        public const int MOD_ALT = 0x0001;
        public const int MOD_CONTROL = 0x0002;
        public const int MOD_NOREPEAT = 0x4000;
        public const int WM_HOTKEY = 0x0312;
        public const int HOTKEY_BOSS_HIDE = 9001;
    }

    internal static class Program
    {
        private const string MutexName = "Local\\MokujiReaderSingleInstanceV1";
        private const string PipeName = "MokujiReaderIpcV1";

        [STAThread]
        static void Main(string[] args)
        {
            NativeMethods.SetProcessDPIAware();
            InstallEmbeddedResolvers();
            RunApp(args);
        }

        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static void RunApp(string[] args)
        {
            bool createdNew;
            using (var mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    SignalRunningInstance();
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm(args));
            }
        }

        private static void SignalRunningInstance()
        {
            try
            {
                using (var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out))
                {
                    client.Connect(1200);
                    var data = Encoding.UTF8.GetBytes("SHOW");
                    client.Write(data, 0, data.Length);
                }
            }
            catch { }
        }

        private static void InstallEmbeddedResolvers()
        {
            // Extract managed & native WebView2 binaries to a real directory on disk so
            // Assembly.Location is non-empty for CoreWebView2Environment.GetAssemblyLocationDirectory().
            string arch = Environment.Is64BitProcess ? "x64" : "x86";
            string nativeDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Mokuji", "runtime-cache", arch);
            Directory.CreateDirectory(nativeDir);

            ExtractResourceToFile("WebView2Loader.dll", Path.Combine(nativeDir, "WebView2Loader.dll"));
            ExtractResourceToFile("Microsoft.Web.WebView2.Core.dll", Path.Combine(nativeDir, "Microsoft.Web.WebView2.Core.dll"));
            ExtractResourceToFile("Microsoft.Web.WebView2.WinForms.dll", Path.Combine(nativeDir, "Microsoft.Web.WebView2.WinForms.dll"));

            NativeMethods.LoadLibrary(Path.Combine(nativeDir, "WebView2Loader.dll"));

            AppDomain.CurrentDomain.AssemblyResolve += (sender, eventArgs) =>
            {
                string simpleName = new AssemblyName(eventArgs.Name).Name + ".dll";
                string candidate = Path.Combine(nativeDir, simpleName);
                return File.Exists(candidate) ? Assembly.LoadFrom(candidate) : null;
            };
        }

        internal static void ExtractResourceToFile(string resourceName, string targetPath)
        {
            var asm = Assembly.GetExecutingAssembly();
            using (var stream = asm.GetManifestResourceStream(resourceName))
            {
                if (stream == null) return;
                if (File.Exists(targetPath) && new FileInfo(targetPath).Length == stream.Length) return;
                try
                {
                    using (var fs = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.Read))
                    {
                        stream.CopyTo(fs);
                    }
                }
                catch (IOException)
                {
                    // Existing copy is locked by another process; reuse it if present.
                }
            }
        }
    }

    public class MainForm : Form
    {
        private const int ServerPort = 5198;
        private const string BaseUrl = "http://127.0.0.1:5198";
        private WebView2 _webView;
        private Panel _splashPanel;
        private Label _splashLabel;
        private NotifyIcon _trayIcon;
        private Process _serverProc;
        private bool _forceExit;
        private bool _shownTrayTip;
        private bool _isFullscreen;
        private FormWindowState _prevState = FormWindowState.Normal;
        private Rectangle _prevBounds;
        private CancellationTokenSource _ipcCts = new CancellationTokenSource();
        private readonly string _startHash;
        private string _serverDir;

        public MainForm(string[] args)
        {
            bool workspaceStart = Array.Exists(args, a => string.Equals(a, "--workspace", StringComparison.OrdinalIgnoreCase));
            _startHash = workspaceStart ? "/?surface=desktop#/workspace" : "/#/shelf";

            Text = "目次 Mokuji";
            Width = 1320;
            Height = 860;
            MinimumSize = new Size(920, 620);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(248, 249, 251);
            KeyPreview = true;

            try { Icon = CreateAppIcon(); } catch { }

            BuildSplash();
            BuildTray();
            StartIpcListener();

            Load += MainForm_Load;
            FormClosing += MainForm_FormClosing;
        }

        private void BuildSplash()
        {
            _splashPanel = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(248, 249, 251)
            };
            var title = new Label
            {
                Text = "目次  Mokuji",
                Font = new Font("Microsoft YaHei UI", 22F, FontStyle.Bold),
                ForeColor = Color.FromArgb(17, 24, 39),
                AutoSize = false,
                TextAlign = ContentAlignment.BottomCenter,
                Dock = DockStyle.Top,
                Height = 320
            };
            _splashLabel = new Label
            {
                Text = "正在唤醒本地书架引擎与桌面阅读视图…",
                Font = new Font("Microsoft YaHei UI", 10.5F, FontStyle.Regular),
                ForeColor = Color.FromArgb(107, 114, 128),
                AutoSize = false,
                TextAlign = ContentAlignment.TopCenter,
                Dock = DockStyle.Fill,
                Padding = new Padding(0, 14, 0, 0)
            };
            _splashPanel.Controls.Add(_splashLabel);
            _splashPanel.Controls.Add(title);
            Controls.Add(_splashPanel);
        }

        private void BuildTray()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开书架首页", null, (s, e) => ShowAndNavigate("/#/shelf"));
            menu.Items.Add("进入摸鱼工作区", null, (s, e) => ShowAndNavigate("/?surface=desktop#/workspace"));
            menu.Items.Add("全网搜书 / 网页嗅探", null, (s, e) => ShowAndNavigate("/#/sources"));
            menu.Items.Add("云同步与 Bangumi 联动", null, (s, e) => ShowAndNavigate("/#/profile"));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("隐藏 / 呼出窗口 (Ctrl+Alt+M)", null, (s, e) => ToggleBossVisibility());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("彻底退出目次", null, (s, e) =>
            {
                _forceExit = true;
                Close();
            });

            _trayIcon = new NotifyIcon
            {
                Text = "目次 Mokuji · 桌面阅读器",
                Icon = Icon ?? SystemIcons.Application,
                Visible = true,
                ContextMenuStrip = menu
            };
            _trayIcon.DoubleClick += (s, e) => RestoreWindow();
        }

        private void StartIpcListener()
        {
            var token = _ipcCts.Token;
            Task.Run(async () =>
            {
                while (!token.IsCancellationRequested)
                {
                    bool backoff = false;
                    try
                    {
                        using (var server = new NamedPipeServerStream("MokujiReaderIpcV1", PipeDirection.In))
                        {
                            await server.WaitForConnectionAsync(token);
                            BeginInvoke((Action)(() => RestoreWindow()));
                        }
                    }
                    catch (OperationCanceledException) { break; }
                    catch { backoff = true; }
                    if (backoff)
                    {
                        try { await Task.Delay(250, token); } catch { break; }
                    }
                }
            }, token);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            NativeMethods.RegisterHotKey(Handle, NativeMethods.HOTKEY_BOSS_HIDE,
                NativeMethods.MOD_CONTROL | NativeMethods.MOD_ALT | NativeMethods.MOD_NOREPEAT, (uint)Keys.M);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == NativeMethods.WM_HOTKEY && m.WParam.ToInt32() == NativeMethods.HOTKEY_BOSS_HIDE)
            {
                ToggleBossVisibility();
            }
            base.WndProc(ref m);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == (Keys.Control | Keys.Shift | Keys.W))
            {
                ToggleWorkspaceOrShelf();
                return true;
            }
            if (keyData == Keys.F11)
            {
                ToggleFullscreen();
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        private async void MainForm_Load(object sender, EventArgs e)
        {
            try
            {
                await EnsureServerRunningAsync();
                try
                {
                    await InitWebViewAsync();
                }
                catch (Exception wvEx)
                {
                    _splashLabel.Text = "正在浏览器中为您打开目次 Mokuji…\n（本机未检测到 WebView2 桌面内核）";
                    Process.Start(new ProcessStartInfo(BaseUrl + _startHash) { UseShellExecute = true });
                    WindowState = FormWindowState.Minimized;
                    Hide();
                    _trayIcon.ShowBalloonTip(3500, "已在默认浏览器打开目次", "后台服务已在托盘运行（未安装 WebView2 运行时：" + wvEx.Message + "），右键托盘可随时退出。", ToolTipIcon.Info);
                }
            }
            catch (Exception ex)
            {
                _splashLabel.Text = "启动遇到问题：" + ex.Message;
                MessageBox.Show(this, ex.Message, "目次 Mokuji 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                _forceExit = true;
                Close();
            }
        }

        private string ResolveServerDir()
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            if (File.Exists(Path.Combine(exeDir, "server.mjs"))) return exeDir;
            string parentDir = Directory.GetParent(exeDir) != null ? Directory.GetParent(exeDir).FullName : "";
            if (!string.IsNullOrEmpty(parentDir) && File.Exists(Path.Combine(parentDir, "server.mjs"))) return parentDir;

            string appCfg = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Mokuji", "server-dir.txt");
            if (File.Exists(appCfg))
            {
                string saved = File.ReadAllText(appCfg, Encoding.UTF8).Trim();
                if (File.Exists(Path.Combine(saved, "server.mjs"))) return saved;
            }

            using (var dlg = new FolderBrowserDialog())
            {
                dlg.Description = "请选择包含 server.mjs 的目次 Mokuji 服务端目录（仅需指定一次）";
                if (dlg.ShowDialog(this) == DialogResult.OK && File.Exists(Path.Combine(dlg.SelectedPath, "server.mjs")))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(appCfg));
                    File.WriteAllText(appCfg, dlg.SelectedPath, Encoding.UTF8);
                    return dlg.SelectedPath;
                }
            }
            throw new InvalidOperationException("未找到 server.mjs，请将 Mokuji.exe 放在目次服务端目录下运行。");
        }

        private string ResolveNodePath(string serverDir)
        {
            string[] candidates =
            {
                Path.Combine(serverDir, "node.exe"),
                Path.Combine(serverDir, "runtime", "node.exe"),
                @"D:\APP\nodejs\node.exe",
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe"
            };
            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';'))
            {
                string trimmed = dir.Trim();
                if (string.IsNullOrEmpty(trimmed)) continue;
                string full = Path.Combine(trimmed, "node.exe");
                if (File.Exists(full)) return full;
            }
            throw new InvalidOperationException("未检测到 Node.js（需要 v24 或更高版本），请先安装 Node.js。");
        }

        private async Task<bool> IsServerHealthyAsync()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(BaseUrl + "/api/local-status");
                req.Timeout = 900;
                req.AllowAutoRedirect = false;
                using (var resp = (HttpWebResponse)await req.GetResponseAsync())
                {
                    if (resp.StatusCode != HttpStatusCode.OK) return false;
                    using (var reader = new StreamReader(resp.GetResponseStream()))
                    {
                        string json = await reader.ReadToEndAsync();
                        return json.Contains("\"duji-local\"");
                    }
                }
            }
            catch { return false; }
        }

        private async Task EnsureServerRunningAsync()
        {
            if (await IsServerHealthyAsync()) return;

            _serverDir = ResolveServerDir();
            string appCfg = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Mokuji", "server-dir.txt");
            Directory.CreateDirectory(Path.GetDirectoryName(appCfg));
            File.WriteAllText(appCfg, _serverDir, Encoding.UTF8);

            string nodeExe = ResolveNodePath(_serverDir);
            string dataDir = Path.Combine(_serverDir, "data");
            Directory.CreateDirectory(dataDir);

            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "--disable-warning=ExperimentalWarning --preserve-symlinks \"" + Path.Combine(_serverDir, "server.mjs") + "\"",
                WorkingDirectory = _serverDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            psi.EnvironmentVariables["DUJI_PORT"] = ServerPort.ToString();
            psi.EnvironmentVariables["DUJI_DATA_DIR"] = dataDir;

            _serverProc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _serverProc.Start();
            _serverProc.BeginOutputReadLine();
            _serverProc.BeginErrorReadLine();

            for (int i = 0; i < 60; i++)
            {
                await Task.Delay(150);
                if (await IsServerHealthyAsync()) return;
                if (_serverProc.HasExited)
                {
                    throw new InvalidOperationException("本地服务进程意外退出（退出码 " + _serverProc.ExitCode + "）。");
                }
            }
            throw new TimeoutException("本地服务启动超时，请检查 5198 端口是否被占用。");
        }

        private async Task InitWebViewAsync()
        {
            string userDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Mokuji", "WebView2Data");
            Directory.CreateDirectory(userDataDir);

            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(248, 249, 251)
            };
            var env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
            await _webView.EnsureCoreWebView2Async(env);

            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _webView.CoreWebView2.Settings.IsZoomControlEnabled = true;

            _webView.CoreWebView2.DocumentTitleChanged += (s, e) =>
            {
                string t = _webView.CoreWebView2.DocumentTitle;
                if (!string.IsNullOrWhiteSpace(t))
                {
                    Text = t;
                    _trayIcon.Text = t.Length > 60 ? t.Substring(0, 60) : t;
                }
            };

            _webView.CoreWebView2.NewWindowRequested += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Uri) && e.Uri.StartsWith(BaseUrl, StringComparison.OrdinalIgnoreCase))
                {
                    e.Handled = true;
                    _webView.CoreWebView2.Navigate(e.Uri);
                }
                else if (!string.IsNullOrEmpty(e.Uri) && (e.Uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || e.Uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase)))
                {
                    e.Handled = true;
                    Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
                }
            };

            _webView.NavigationCompleted += (s, e) =>
            {
                if (_splashPanel != null && _splashPanel.Visible)
                {
                    _splashPanel.Visible = false;
                }
            };

            Controls.Add(_webView);
            _webView.BringToFront();
            _splashPanel.BringToFront();
            _webView.Source = new Uri(BaseUrl + _startHash);
        }

        private void ShowAndNavigate(string pathAndHash)
        {
            RestoreWindow();
            if (_webView != null && _webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.Navigate(BaseUrl + pathAndHash);
            }
        }

        private void ToggleWorkspaceOrShelf()
        {
            if (_webView == null || _webView.CoreWebView2 == null) return;
            string cur = _webView.CoreWebView2.Source ?? "";
            bool inWork = cur.Contains("#/workspace") || cur.Contains("#/work/");
            _webView.CoreWebView2.Navigate(BaseUrl + (inWork ? "/#/shelf" : "/?surface=desktop#/workspace"));
        }

        private void ToggleBossVisibility()
        {
            if (Visible && WindowState != FormWindowState.Minimized)
            {
                Hide();
            }
            else
            {
                RestoreWindow();
            }
        }

        private void RestoreWindow()
        {
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        private void ToggleFullscreen()
        {
            if (!_isFullscreen)
            {
                _prevState = WindowState;
                _prevBounds = Bounds;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Maximized;
                _isFullscreen = true;
            }
            else
            {
                FormBorderStyle = FormBorderStyle.Sizable;
                WindowState = _prevState == FormWindowState.Minimized ? FormWindowState.Normal : _prevState;
                if (WindowState == FormWindowState.Normal) Bounds = _prevBounds;
                _isFullscreen = false;
            }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (!_forceExit && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                if (!_shownTrayTip)
                {
                    _shownTrayTip = true;
                    _trayIcon.ShowBalloonTip(2200, "目次已在托盘继续运行", "按 Ctrl+Alt+M 可随时隐藏/呼出窗口，右键托盘图标可切换摸鱼工作区或彻底退出。", ToolTipIcon.Info);
                }
                return;
            }

            NativeMethods.UnregisterHotKey(Handle, NativeMethods.HOTKEY_BOSS_HIDE);
            _ipcCts.Cancel();
            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
            }
            try
            {
                if (_serverProc != null && !_serverProc.HasExited)
                {
                    _serverProc.Kill();
                }
            }
            catch { }
        }

        private static Icon CreateAppIcon()
        {
            using (var bmp = new Bitmap(64, 64))
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (var bg = new LinearGradientBrush(new Rectangle(0, 0, 64, 64), Color.FromArgb(94, 106, 210), Color.FromArgb(124, 58, 237), 45F))
                using (var path = RoundedRect(new Rectangle(4, 4, 56, 56), 14))
                {
                    g.FillPath(bg, path);
                }
                using (var pen = new Pen(Color.White, 3.6F))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    pen.LineJoin = LineJoin.Round;
                    g.DrawLines(pen, new[] { new PointF(18, 22), new PointF(32, 25), new PointF(32, 46), new PointF(18, 43), new PointF(18, 22) });
                    g.DrawLines(pen, new[] { new PointF(46, 22), new PointF(32, 25), new PointF(32, 46), new PointF(46, 43), new PointF(46, 22) });
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        private static GraphicsPath RoundedRect(Rectangle bounds, int radius)
        {
            int d = radius * 2;
            var path = new GraphicsPath();
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
