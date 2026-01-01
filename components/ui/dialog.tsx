"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { topPosition?: string; onClose?: () => void }
>(({ className, children, topPosition, style, onClose, ...props }, ref) => {
  // classNameに!z-[99999]が含まれている場合、またはzIndexが高い場合は、オーバーレイのz-indexも調整
  const hasHighZIndex = className?.includes('!z-[99999]') || (style?.zIndex && (style.zIndex as number) >= 10000);
  const contentRef = React.useRef<HTMLDivElement>(null);
  
  // refをマージ（forwardRefとuseRefの両方に対応）
  const mergedRef = React.useCallback((node: HTMLDivElement | null) => {
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
    contentRef.current = node;
  }, [ref]);
  
  // data-stateがopenのときにaria-hiddenをfalseに設定し、表示を確実にする
  React.useEffect(() => {
    const checkAndUpdate = () => {
      if (contentRef.current) {
        const isOpen = contentRef.current.getAttribute('data-state') === 'open';
        if (isOpen) {
          contentRef.current.setAttribute('aria-hidden', 'false');
          contentRef.current.removeAttribute('data-aria-hidden');
          // 表示を確実にするためのスタイルを直接設定（!importantを使用）
          contentRef.current.style.setProperty('pointer-events', 'auto', 'important');
          // classNameに!flexが含まれている場合は、flexレイアウトを使用
          const hasFlexClass = contentRef.current.className?.includes('!flex');
          if (hasFlexClass) {
            contentRef.current.style.setProperty('display', 'flex', 'important');
            contentRef.current.style.setProperty('flex-direction', 'column', 'important');
            contentRef.current.style.setProperty('overflow', 'hidden', 'important');
          } else {
            contentRef.current.style.setProperty('display', 'grid', 'important');
          }
          contentRef.current.style.setProperty('visibility', 'visible', 'important');
          contentRef.current.style.setProperty('opacity', '1', 'important');
          contentRef.current.style.setProperty('position', 'fixed', 'important');
          contentRef.current.style.setProperty('z-index', '99999', 'important');
          // 位置を確実に設定
          if (!contentRef.current.style.left || contentRef.current.style.left === '') {
            contentRef.current.style.setProperty('left', '50%', 'important');
            contentRef.current.style.setProperty('top', '50%', 'important');
            contentRef.current.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
          }
        }
      }
    };
    
    // 即座に実行
    checkAndUpdate();
    
    // MutationObserverでdata-stateの変更を監視
    const observer = new MutationObserver(checkAndUpdate);
    if (contentRef.current) {
      observer.observe(contentRef.current, {
        attributes: true,
        attributeFilter: ['data-state', 'aria-hidden'],
      });
    }
    
    // 定期的にチェック（アニメーションの遅延に対応）
    const interval = setInterval(checkAndUpdate, 100);
    
    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, []);
  
  return (
    <DialogPortal>
      <DialogOverlay 
        className={hasHighZIndex ? "!z-[99998] backdrop-blur-sm" : undefined} 
        style={hasHighZIndex ? { 
          zIndex: 99998, 
          backgroundColor: 'rgba(0, 0, 0, 0.5)', 
          pointerEvents: 'auto',
          display: 'block',
          visibility: 'visible',
          opacity: 1,
        } : undefined} 
      />
      <DialogPrimitive.Content
        ref={mergedRef}
        className={cn(
          "fixed grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg",
          // カスタム位置が指定されていない場合のみ中央配置
          !className?.includes('!top-') && !className?.includes('!right-') && !className?.includes('!left-') && (topPosition || "left-[50%] translate-x-[-50%] top-[50%] translate-y-[-50%]"),
          className || "z-50"
        )}
        style={{
          ...(topPosition ? { transform: 'translateX(-50%) translateY(0)' } : {}),
          ...style,
          // パスワードダイアログの場合、カスタム位置が指定されていない場合のみ中央配置
          ...(style?.zIndex === 10002 && !style?.top && !style?.right && !style?.left ? {
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) !important',
          } : {}),
          // pointer-eventsを明示的にautoに設定（Radix UIがnoneに設定するのを防ぐ）
          // !importantを使用して確実に適用されるようにする
          pointerEvents: 'auto',
          // bodyのpointer-events: noneを上書きするために、position: fixedとz-indexを確実に設定
          position: 'fixed',
          // 表示を確実にするためのスタイル
          display: 'grid',
          visibility: 'visible',
          opacity: 1,
        } as React.CSSProperties}
        {...props}
        aria-hidden={false}
      >
        {children}
        <DialogPrimitive.Close 
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}

