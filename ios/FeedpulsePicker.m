#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (FeedpulsePicker, NSObject)
RCT_EXTERN_METHOD(pickTarget:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancelPick)
@end
