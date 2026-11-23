#ifdef MOKUJI_CROSS
#import "PublicAPI.h"
#else
#import <UIKit/UIKit.h>
#import <SafariServices/SafariServices.h>
#endif

static NSString *const addressKey=@"MokujiServerOrigin";

static BOOL privateIPv4(const char *host) {
    if(!host || !*host) return NO;
    unsigned octets[4];
    const char *c=host;
    for(unsigned i=0;i<4;i++) {
        const char *start=c;
        unsigned value=0;
        while(*c>='0' && *c<='9'){value=value*10+(*c++-'0'); if(c-start>3 || value>255)return NO;}
        if(c==start || (c-start>1 && *start=='0')) return NO;
        octets[i]=value;
        if(i<3 && *c++!='.')return NO;
    }
    return !*c && (octets[0]==10 || (octets[0]==192 && octets[1]==168) || (octets[0]==172 && octets[1]>=16 && octets[1]<=31));
}

static NSURL *readerAddress(NSString *raw) {
    NSString *s=[raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if(!s.length || s.length>2048)return nil;
    const char *bytes=s.UTF8String;
    for(const char *c=bytes;*c;c++){if((unsigned char)*c<=32 || *c=='\\' || *c==127)return nil;}
    if(![s.lowercaseString hasPrefix:@"https://"] && ![s.lowercaseString hasPrefix:@"http://"]) {
        NSURLComponents *draft=[NSURLComponents componentsWithString:[@"https://" stringByAppendingString:s]];
        s=[(privateIPv4(draft.host.UTF8String)?@"http://":@"https://") stringByAppendingString:s];
    }
    NSURLComponents *parts=[NSURLComponents componentsWithString:s];
    NSString *scheme=parts.scheme.lowercaseString;
    if(!parts.host.length || parts.user!=nil || parts.password!=nil)return nil;
    if(![scheme isEqualToString:@"https"] && (!([scheme isEqualToString:@"http"] && privateIPv4(parts.host.UTF8String))))return nil;
    NSNumber *port=parts.port;
    if(port && (port.integerValue<1 || port.integerValue>65535))return nil;
    parts.query=nil; parts.fragment=nil; parts.path=@"/";
    return parts.URL;
}
@interface MKConnect:UIViewController <SFSafariViewControllerDelegate,UITextFieldDelegate>
@property(strong) UILabel *brand,*hint,*error;
@property(strong) UITextField *field;
@property(strong) UIButton *openButton;
@property BOOL offeredLastAddress;
@end
@implementation MKConnect
- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor=[UIColor systemBackgroundColor];
    self.brand=[[UILabel alloc]init];
    self.brand.font=[UIFont boldSystemFontOfSize:31]; self.brand.text=@"目次 Mokuji";
    self.hint=[[UILabel alloc]init]; self.hint.numberOfLines=0;
    self.hint.font=[UIFont systemFontOfSize:16]; self.hint.textColor=[UIColor secondaryLabelColor];
    self.hint.text=@"填入电脑「手机连接」显示的书架地址，或你的 HTTPS 服务器网址。";
    self.field=[[UITextField alloc]init]; self.field.placeholder=@"书架地址"; self.field.borderStyle=3;
    self.field.keyboardType=3; self.field.returnKeyType=9; self.field.autocapitalizationType=0;
    self.field.autocorrectionType=1; self.field.spellCheckingType=1; self.field.delegate=self;
    self.field.text=[[NSUserDefaults standardUserDefaults] stringForKey:addressKey];
    self.openButton=[UIButton buttonWithType:1]; [self.openButton setTitle:@"打开书架" forState:0];
    self.openButton.titleLabel.font=[UIFont boldSystemFontOfSize:19]; self.openButton.contentHorizontalAlignment=1;
    [self.openButton addTarget:self action:@selector(openShelf) forControlEvents:1UL<<6];
    self.error=[[UILabel alloc]init]; self.error.numberOfLines=0; self.error.font=[UIFont systemFontOfSize:15];
    self.error.textColor=[UIColor systemRedColor];
    [self.view addSubview:self.brand]; [self.view addSubview:self.hint]; [self.view addSubview:self.field];
    [self.view addSubview:self.openButton]; [self.view addSubview:self.error];
}
- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    UIEdgeInsets inset=self.view.safeAreaInsets;
    CGFloat width=self.view.bounds.size.width-inset.left-inset.right-44;
    if(width>540)width=540;
    CGFloat left=(self.view.bounds.size.width-width)/2;
    CGFloat top=inset.top+18;
    self.brand.frame=CGRectMake(left,top,width,46);
    self.hint.frame=CGRectMake(left,top+53,width,66);
    self.field.frame=CGRectMake(left,top+129,width,45);
    self.openButton.frame=CGRectMake(left,top+185,width,44);
    self.error.frame=CGRectMake(left,top+238,width,66);
}
- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    if(!self.offeredLastAddress) {
        self.offeredLastAddress=YES;
        if(readerAddress(self.field.text)) [self openShelf];
    }
}
- (void)safariViewControllerDidFinish:(SFSafariViewController *)reader { [self dismissViewControllerAnimated:YES completion:nil]; }
- (BOOL)textFieldShouldReturn:(UITextField *)field { [self openShelf]; return YES; }
- (void)openShelf {
    NSURL *u=readerAddress(self.field.text);
    if(!u){self.error.text=@"请输入有效的 HTTPS 地址；局域网可使用电脑显示的私有 IPv4 地址和端口。";return;}
    self.error.text=nil; self.field.text=u.absoluteString;
    [[NSUserDefaults standardUserDefaults] setObject:u.absoluteString forKey:addressKey];
    [self.view endEditing:YES];
    SFSafariViewController *reader=[[SFSafariViewController alloc]initWithURL:u];
    reader.dismissButtonStyle=0; reader.delegate=self;
    [self presentViewController:reader animated:YES completion:nil];
}
@end

@interface MKAppDelegate:UIResponder <UIApplicationDelegate>
@property(strong) UIWindow *window;
@end
@implementation MKAppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.window=[[UIWindow alloc]initWithFrame:[UIScreen mainScreen].bounds];
    self.window.rootViewController=[[MKConnect alloc]init];
    [self.window makeKeyAndVisible];
    return YES;
}
@end
int main(int argc,char **argv) {
    @autoreleasepool { return UIApplicationMain(argc,argv,nil,@"MKAppDelegate"); }
}
