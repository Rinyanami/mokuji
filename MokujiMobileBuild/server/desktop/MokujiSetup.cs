using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace MokujiInstaller
{
    static class Native
    {
        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();
    }

    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            Native.SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }

    public class SetupForm : Form
    {
        private TextBox _pathBox;
        private CheckBox _shortcutCheck;
        private CheckBox _launchCheck;
        private ProgressBar _progress;
        private Label _statusLabel;
        private Button _installBtn;
        private Button _browseBtn;
        private bool _installing;

        public SetupForm()
        {
            Text = "目次 Mokuji · 桌面客户端安装向导";
            Width = 560;
            Height = 365;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(248, 249, 251);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            string defaultDir = Directory.Exists(@"D:\APP")
                ? @"D:\APP\Mokuji"
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Mokuji");

            var title = new Label
            {
                Text = "安装 目次 Mokuji（全功能桌面版）",
                Font = new Font("Microsoft YaHei UI", 14.5F, FontStyle.Bold),
                ForeColor = Color.FromArgb(17, 24, 39),
                Location = new Point(26, 22),
                AutoSize = true
            };

            var sub = new Label
            {
                Text = "整合 Bangumi 级自定义书架 · 多书源与网页嗅探 · 六套拟真摸鱼工作区 · 全局老板键 (Ctrl+Alt+M)\r\n内置独立运行环境，免配置 Node.js，解压即用。",
                Font = new Font("Microsoft YaHei UI", 9.2F),
                ForeColor = Color.FromArgb(90, 98, 112),
                Location = new Point(28, 56),
                Size = new Size(495, 42)
            };

            var dirTitle = new Label
            {
                Text = "安装目录：",
                Font = new Font("Microsoft YaHei UI", 9.5F, FontStyle.Bold),
                ForeColor = Color.FromArgb(31, 41, 55),
                Location = new Point(28, 112),
                AutoSize = true
            };

            _pathBox = new TextBox
            {
                Text = defaultDir,
                Location = new Point(28, 138),
                Size = new Size(406, 28),
                Font = new Font("Microsoft YaHei UI", 9.5F)
            };

            _browseBtn = new Button
            {
                Text = "浏览…",
                Location = new Point(442, 136),
                Size = new Size(78, 30),
                Font = new Font("Microsoft YaHei UI", 9.2F),
                FlatStyle = FlatStyle.System
            };
            _browseBtn.Click += (s, e) =>
            {
                using (var dlg = new FolderBrowserDialog())
                {
                    dlg.SelectedPath = _pathBox.Text;
                    dlg.Description = "选择 目次 Mokuji 的安装文件夹";
                    if (dlg.ShowDialog(this) == DialogResult.OK)
                    {
                        string p = dlg.SelectedPath.TrimEnd('\\');
                        if (!p.EndsWith("Mokuji", StringComparison.OrdinalIgnoreCase))
                        {
                            p = Path.Combine(p, "Mokuji");
                        }
                        _pathBox.Text = p;
                    }
                }
            };

            _shortcutCheck = new CheckBox
            {
                Text = "在桌面创建统一快捷方式「目次 Mokuji」（单入口含书架与工作区）",
                Checked = true,
                Location = new Point(28, 178),
                Size = new Size(480, 24),
                Font = new Font("Microsoft YaHei UI", 9.2F)
            };

            _launchCheck = new CheckBox
            {
                Text = "安装完成后立即启动 目次 Mokuji",
                Checked = true,
                Location = new Point(28, 206),
                Size = new Size(480, 24),
                Font = new Font("Microsoft YaHei UI", 9.2F)
            };

            _progress = new ProgressBar
            {
                Location = new Point(28, 244),
                Size = new Size(492, 18),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };

            _statusLabel = new Label
            {
                Text = "准备就绪，点击「立即安装」开始部署。",
                Location = new Point(28, 268),
                Size = new Size(340, 22),
                Font = new Font("Microsoft YaHei UI", 8.8F),
                ForeColor = Color.FromArgb(107, 114, 128)
            };

            _installBtn = new Button
            {
                Text = "立即安装",
                Location = new Point(410, 272),
                Size = new Size(110, 34),
                Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold),
                BackColor = Color.FromArgb(94, 106, 210),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            _installBtn.FlatAppearance.BorderSize = 0;
            _installBtn.Click += async (s, e) => await StartInstallAsync();

            Controls.AddRange(new Control[]
            {
                title, sub, dirTitle, _pathBox, _browseBtn,
                _shortcutCheck, _launchCheck, _progress, _statusLabel, _installBtn
            });
        }

        private async Task StartInstallAsync()
        {
            if (_installing) return;
            string targetDir = (_pathBox.Text ?? "").Trim();
            if (string.IsNullOrEmpty(targetDir))
            {
                MessageBox.Show(this, "请先指定有效安装目录。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _installing = true;
            _installBtn.Enabled = false;
            _browseBtn.Enabled = false;
            _pathBox.Enabled = false;
            _statusLabel.Text = "正在写入应用与独立运行环境，请稍候…";
            _progress.Value = 12;

            try
            {
                bool createShortcut = _shortcutCheck.Checked;
                await Task.Run(() =>
                {
                    Directory.CreateDirectory(targetDir);
                    string tempZip = Path.Combine(Path.GetTempPath(), "MokujiPayload_" + Guid.NewGuid().ToString("N") + ".zip");
                    try
                    {
                        var asm = Assembly.GetExecutingAssembly();
                        using (var stream = asm.GetManifestResourceStream("MokujiPayload.zip"))
                        {
                            if (stream == null) throw new InvalidOperationException("安装包载荷损坏。");
                            using (var fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                            {
                                stream.CopyTo(fs);
                            }
                        }

                        BeginInvoke((Action)(() =>
                        {
                            _progress.Value = 35;
                            _statusLabel.Text = "正在解压文件到目标目录…";
                        }));

                        using (var archive = ZipFile.OpenRead(tempZip))
                        {
                            int total = archive.Entries.Count;
                            int done = 0;
                            foreach (var entry in archive.Entries)
                            {
                                string destPath = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
                                if (!destPath.StartsWith(Path.GetFullPath(targetDir), StringComparison.OrdinalIgnoreCase)) continue;
                                if (string.IsNullOrEmpty(entry.Name))
                                {
                                    Directory.CreateDirectory(destPath);
                                }
                                else
                                {
                                    Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                                    // Preserve existing user data if upgrading an already installed copy
                                    if (entry.FullName.StartsWith("data/", StringComparison.OrdinalIgnoreCase) && File.Exists(destPath))
                                    {
                                        done++;
                                        continue;
                                    }
                                    entry.ExtractToFile(destPath, true);
                                }
                                done++;
                                if (total > 0 && (done % 15 == 0 || done == total))
                                {
                                    int pct = 35 + (int)((done * 60.0) / total);
                                    BeginInvoke((Action)(() => _progress.Value = Math.Min(95, pct)));
                                }
                            }
                        }

                        if (createShortcut)
                        {
                            CreateDesktopShortcut(Path.Combine(targetDir, "Mokuji.exe"), targetDir);
                        }
                    }
                    finally
                    {
                        try { if (File.Exists(tempZip)) File.Delete(tempZip); } catch { }
                    }
                });

                _progress.Value = 100;
                _statusLabel.Text = "安装完成！已安装到：" + targetDir;

                string exePath = Path.Combine(targetDir, "Mokuji.exe");
                if (_launchCheck.Checked && File.Exists(exePath))
                {
                    Process.Start(new ProcessStartInfo(exePath) { WorkingDirectory = targetDir, UseShellExecute = true });
                }
                else
                {
                    MessageBox.Show(this, "目次 Mokuji 已成功安装到：\n" + targetDir, "安装完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                Close();
            }
            catch (Exception ex)
            {
                _installing = false;
                _installBtn.Enabled = true;
                _browseBtn.Enabled = true;
                _pathBox.Enabled = true;
                _statusLabel.Text = "安装失败：" + ex.Message;
                MessageBox.Show(this, "安装出错：\n" + ex.Message, "安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static void CreateDesktopShortcut(string exePath, string workDir)
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string lnkPath = Path.Combine(desktop, "目次 Mokuji.lnk");
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
            Type scType = shortcut.GetType();
            scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { exePath });
            scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
            scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { exePath + ",0" });
            scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "目次 Mokuji（书架 · 摸鱼工作区 · 书源嗅探 · 多端同步一体化客户端）" });
            scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
    }
}
