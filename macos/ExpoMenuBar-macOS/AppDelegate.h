#import <Cocoa/Cocoa.h>

@class RCTBridge;

@interface AppDelegate : NSObject <NSApplicationDelegate>
{
  NSStatusItem *statusItem;
  NSPopover *popover;
}

@property(nonatomic, readonly) RCTBridge *bridge;

@end
