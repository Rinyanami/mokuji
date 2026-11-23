const target=document.querySelector('#target');
const help=document.querySelector('#connection-help');
const copy=document.querySelector('#copy');
const status=document.querySelector('#copied');
async function configure() {
  let address=location.origin+'/';
  if (['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
    try {
      const response=await fetch('/api/mobile',{cache:'no-store'});
      const state=await response.json();
      address=state.enabled && state.urls?.[0] || '';
    } catch { address=''; }
  }
  if(!address) {
    target.textContent='请在电脑的「手机连接」中开启访问，再使用手机扫描安装二维码。';
    return;
  }
  target.textContent=address;
  copy.hidden=false;
  help.textContent=address.startsWith('http://')?'使用局域网书架时，请保持电脑开机，手机和电脑连接同一网络。':'手机和电脑连接同一个服务器地址，即可打开同一份书架。';
  copy.addEventListener('click',async()=>{
    try { await navigator.clipboard.writeText(address); status.textContent='地址已复制'; }
    catch { const range=document.createRange();range.selectNodeContents(target);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);status.textContent='地址已选中，请长按或使用系统复制。'; }
  });
}
void configure();