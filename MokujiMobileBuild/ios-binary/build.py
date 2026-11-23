"""Build Mokuji for iOS 17+ ARM64 with Zig 0.13.0, and inspect its Mach-O with LIEF.
Usage: python build.py <zig-executable> <output-ipa>
The result requires signing and provisioning using the iPhone owner's Apple Account.
"""
import hashlib
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import zipfile
from collections import defaultdict

import lief

HERE = Path(__file__).resolve().parent
FRAMEWORK = '/System/Library/Frameworks/{name}.framework/{name}'
BUNDLE_ID = 'dev.mokuji.personalreader'

def image(path):
    container = lief.MachO.parse(str(path))
    if container is None or len(container) != 1:
        raise ValueError(f'Expected one Mach-O image in {path}')
    return container, container.at(0)

def owner(symbol):
    if symbol.startswith(('_OBJC_CLASS_$_UI', '_OBJC_METACLASS_$_UI')) or symbol == '_UIApplicationMain':
        return 'UIKit', FRAMEWORK.format(name='UIKit')
    if symbol == '_OBJC_CLASS_$_SFSafariViewController':
        return 'SafariServices', FRAMEWORK.format(name='SafariServices')
    if symbol.startswith('_OBJC_CLASS_$_NS'):
        return 'Foundation', FRAMEWORK.format(name='Foundation')
    if symbol == '___CFConstantStringClassReference':
        return 'CoreFoundation', FRAMEWORK.format(name='CoreFoundation')
    if symbol.startswith(('_objc_', '__objc_')) or symbol == '_OBJC_METACLASS_$_NSObject':
        return 'objc', '/usr/lib/libobjc.A.dylib'
    raise ValueError('No known system library provides '+symbol)

def interfaces(obj, target):
    # The executable links public symbols of the real iOS libraries. These text
    # interfaces are build-only linker inputs; no Apple SDK files are bundled.
    container, binary = image(obj)
    groups = defaultdict(list)
    for symbol in binary.symbols:
        if symbol.is_external and not symbol.value:
            groups[owner(symbol.name)].append(symbol.name)
    groups['System','/usr/lib/libSystem.B.dylib'] = ['dyld_stub_binder']
    for (lib, install_name), symbols in groups.items():
        entries=', '.join("'"+symbol+"'" for symbol in sorted(set(symbols)))
        spec=f"--- !tapi-tbd\ntbd-version: 4\ntargets: [ arm64-ios ]\ninstall-name: '{install_name}'\nexports:\n  - targets: [ arm64-ios ]\n    symbols: [ {entries} ]\n...\n"
        (target/('lib'+lib+'.tbd')).write_text(spec, encoding='utf8')
    return groups

def info():
    icon={'CFBundleIconFiles':['AppIcon60x60'],'UIPrerenderedIcon':False}
    return {
        'CFBundleDevelopmentRegion':'zh_CN', 'CFBundleDisplayName':'目次',
        'CFBundleExecutable':'Mokuji','CFBundleIdentifier':BUNDLE_ID,
        'CFBundleInfoDictionaryVersion':'6.0','CFBundleName':'Mokuji',
        'CFBundlePackageType':'APPL','CFBundleShortVersionString':'1.0',
        'CFBundleVersion':'1','CFBundleSupportedPlatforms':['iPhoneOS'],
        'MinimumOSVersion':'17.0','LSRequiresIPhoneOS':True,'UIDeviceFamily':[1],
        'UIRequiredDeviceCapabilities':['arm64'],'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait'],
        'UILaunchScreen':{},'CFBundleIcons':{'CFBundlePrimaryIcon':icon},
        'NSLocalNetworkUsageDescription':'目次需要通过本地网络连接你的电脑并打开你的阅读书架。',
        'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True,'NSExceptionDomains':{
            network:{'NSExceptionAllowsInsecureHTTPLoads':True} for network in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16']
        }}
    }

def validate(executable, groups):
    container, binary=image(executable)
    assert binary.header.cpu_type==lief.MachO.Header.CPU_TYPE.ARM64
    assert binary.header.file_type==lief.MachO.Header.FILE_TYPE.EXECUTE
    assert binary.has_main_command and binary.main_command.entrypoint > 0
    assert binary.has_build_version and binary.build_version.platform==lief.MachO.BuildVersion.PLATFORMS.IOS
    assert binary.build_version.minos==[17,0,0] and binary.build_version.sdk==[17,0,0]
    assert not binary.has_code_signature
    assert binary.get_section('__objc_classlist').size >= 16
    assert {lib.name for lib in binary.libraries}=={path for name,path in groups}
    assert lief.MachO.check_layout(binary)[0]

def archive(ipa, files):
    with zipfile.ZipFile(ipa,'w',compression=zipfile.ZIP_DEFLATED) as out:
        for name,content in files.items():
            entry=zipfile.ZipInfo('Payload/Mokuji.app/'+name, (2026,11,18,0,0,0))
            entry.create_system=3
            entry.external_attr=((0o100755 if name=='Mokuji' else 0o100644)<<16)
            out.writestr(entry,content,compress_type=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(ipa) as check:
        assert check.testzip() is None
        assert check.getinfo('Payload/Mokuji.app/Mokuji').external_attr>>16 == 0o100755
        assert plistlib.loads(check.read('Payload/Mokuji.app/Info.plist'))==info()

def main():
    if len(sys.argv)!=3: raise SystemExit(__doc__)
    zig=Path(sys.argv[1]).resolve(strict=True)
    ipa=Path(sys.argv[2]).resolve()
    with tempfile.TemporaryDirectory(prefix='Mokuji-iOS-') as tmp:
        work=Path(tmp)
        env={**os.environ,'ZIG_GLOBAL_CACHE_DIR':str(Path(tempfile.gettempdir())/'MokujiZigCache'),
             'ZIG_LOCAL_CACHE_DIR':str(work/'cache')}
        def run(args): subprocess.run([str(zig),*args], cwd=work, env=env, check=True)
        run(['cc','-target','aarch64-ios.17.0','-DMOKUJI_CROSS','-g0','-O2','-ffreestanding',
             '-fobjc-arc','-fblocks','-fno-stack-protector','-c',str(HERE/'Mokuji.m'),'-o','main.o'])
        groups=interfaces(work/'main.o',work)
        run(['build-exe','-O','ReleaseSmall','-fstrip','-headerpad','1000','-target','aarch64-ios.17.0','-L.',
             *['-l'+lib for lib,path in groups if lib!='System'],'-lc','main.o','-femit-bin=Mokuji'])
        validate(work/'Mokuji',groups)
        files={'Info.plist':plistlib.dumps(info(),fmt=plistlib.FMT_BINARY),'Mokuji':(work/'Mokuji').read_bytes()}
        for n in (2,3):
            name=f'AppIcon60x60@{n}x.png'
            files[name]=(HERE/name).read_bytes()
        archive(ipa,files)
    print(ipa,ipa.stat().st_size,hashlib.sha256(ipa.read_bytes()).hexdigest())

if __name__=='__main__': main()
