#import "AutoResizerRootView.h"
#import "Expo_Orbit-Swift.h"

const CGFloat minimumViewSize = 40.0;

@implementation AutoResizerRootView


- (void)setEnabled:(BOOL)enabled
{
  if (_enabled != enabled) {
    _enabled = enabled;
  }
}


- (void)layout
{
  if(!_enabled || (self.frame.size.height <= minimumViewSize || self.frame.size.width <= minimumViewSize)){
    return;
  }

  CGFloat frameHeight = self.frame.size.height;

  NSRect mainScreenFrame = [[NSScreen mainScreen] frame];
  CGFloat screenHeight = NSHeight(mainScreenFrame);
  CGFloat maxHeight = screenHeight * _maxRelativeHeight;

  CGFloat newHeight = frameHeight <= maxHeight ? frameHeight : maxHeight;

  dispatch_async(dispatch_get_main_queue(), ^{
    [PopoverManager.shared setPopoverContentSize:CGSizeMake(self.frame.size.width, newHeight)];
  });
}

@end
