#pragma once
// Declarations of the public system APIs used by this small single-screen app.
// Use the standard Apple SDK headers instead when building in Xcode.
typedef _Bool BOOL;
typedef unsigned long NSUInteger;
typedef long NSInteger;
typedef double CGFloat;
typedef struct {CGFloat x,y;} CGPoint;
typedef struct {CGFloat width,height;} CGSize;
typedef struct {CGPoint origin; CGSize size;} CGRect;
typedef struct {CGFloat top,left,bottom,right;} UIEdgeInsets;
#define nil ((id)0)
#define YES ((BOOL)1)
#define NO ((BOOL)0)
static inline CGRect CGRectMake(CGFloat x,CGFloat y,CGFloat w,CGFloat h){return (CGRect){{x,y},{w,h}};}
@class NSString,NSNumber,NSURL,NSURLComponents,NSDictionary,UIColor,UIFont,UIViewController,UITextField;
__attribute__((objc_root_class))
@interface NSObject { Class isa; }
+ (instancetype)alloc;
- (instancetype)init;
@end
@interface NSString:NSObject
@property(readonly) const char *UTF8String;
@property(readonly) NSUInteger length;
@property(readonly,copy) NSString *lowercaseString;
- (BOOL)hasPrefix:(NSString *)prefix;
- (BOOL)isEqualToString:(NSString *)s;
- (NSString *)stringByAppendingString:(NSString *)s;
- (NSString *)stringByTrimmingCharactersInSet:(id)set;
@end
@interface NSCharacterSet:NSObject
+ (instancetype)whitespaceAndNewlineCharacterSet;
@end
@interface NSNumber:NSObject
@property(readonly) NSInteger integerValue;
@end
@interface NSURL:NSObject
@property(readonly,copy) NSString *absoluteString;
@end
@interface NSURLComponents:NSObject
+ (instancetype)componentsWithString:(NSString *)s;
@property(copy) NSString *scheme,*host,*user,*password,*path,*query,*fragment;
@property(copy) NSNumber *port;
@property(readonly,copy) NSURL *URL;
@end
@interface NSUserDefaults:NSObject
+ (instancetype)standardUserDefaults;
- (NSString *)stringForKey:(NSString *)key;
- (void)setObject:(id)value forKey:(NSString *)key;
@end
@interface UIResponder:NSObject @end
@interface UIColor:NSObject
+ (instancetype)systemBackgroundColor;
+ (instancetype)secondarySystemBackgroundColor;
+ (instancetype)labelColor;
+ (instancetype)secondaryLabelColor;
+ (instancetype)systemRedColor;
+ (instancetype)systemGreenColor;
@end
@interface UIFont:NSObject
+ (instancetype)systemFontOfSize:(CGFloat)size;
+ (instancetype)boldSystemFontOfSize:(CGFloat)size;
@end
@interface UIView:UIResponder
@property CGRect frame,bounds;
@property(readonly) UIEdgeInsets safeAreaInsets;
@property(strong) UIColor *backgroundColor;
- (void)addSubview:(UIView *)view;
- (BOOL)endEditing:(BOOL)force;
@end
@interface UILabel:UIView
@property(copy) NSString *text;
@property(strong) UIColor *textColor;
@property(strong) UIFont *font;
@property NSInteger numberOfLines;
@end
@interface UIControl:UIView
- (void)addTarget:(id)t action:(SEL)s forControlEvents:(NSUInteger)e;
@end
@interface UITextField:UIControl
@property(copy) NSString *text,*placeholder;
@property NSInteger borderStyle,keyboardType,returnKeyType,autocapitalizationType,autocorrectionType,spellCheckingType;
@property(weak) id delegate;
@end
@interface UIButton:UIControl
+ (instancetype)buttonWithType:(NSInteger)type;
- (void)setTitle:(NSString *)title forState:(NSUInteger)state;
@property(readonly,strong) UILabel *titleLabel;
@property NSInteger contentHorizontalAlignment;
@end
@interface UIViewController:UIResponder
@property(strong) UIView *view;
- (void)viewDidLoad;
- (void)viewDidLayoutSubviews;
- (void)viewDidAppear:(BOOL)animated;
- (void)dismissViewControllerAnimated:(BOOL)animated completion:(void (^)(void))completion;
- (void)presentViewController:(UIViewController *)c animated:(BOOL)a completion:(void (^)(void))completion;
@end
@interface UIScreen:NSObject
+ (instancetype)mainScreen;
@property(readonly) CGRect bounds;
@end
@interface UIWindow:UIView
- (instancetype)initWithFrame:(CGRect)frame;
@property(strong) UIViewController *rootViewController;
- (void)makeKeyAndVisible;
@end
@class UIApplication;
@interface UIApplication:UIResponder @end
@protocol UIApplicationDelegate @end
@protocol SFSafariViewControllerDelegate @end
@protocol UITextFieldDelegate @end
@interface SFSafariViewController:UIViewController
@property(weak) id delegate;
- (instancetype)initWithURL:(NSURL *)url;
@property NSInteger dismissButtonStyle;
@end
extern int UIApplicationMain(int argc,char **argv,NSString *principal,NSString *delegateName);
