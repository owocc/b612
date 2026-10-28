'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Layout } from '@astryxdesign/core/Layout';
import { LayoutHeader } from '@astryxdesign/core/Layout';
import { LayoutContent } from '@astryxdesign/core/Layout';
import { LayoutFooter } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useAppToast } from '@/lib/toast';
import { UserAvatar } from '@/components/user-avatar';
import { SafeImage } from '@/components/safe-image';
import { createPost } from '@/server/actions/feed';
import { ImagePlus, X } from 'lucide-react';

const MAX_POST_IMAGES = 9;

const styles = stylex.create({
  trigger: {
    display: 'inline-flex',
    cursor: 'pointer',
  },
  defaultTrigger: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    borderRadius: 'var(--radius-container)',
    paddingInline: 8,
    paddingBlock: 12,
    textAlign: 'left',
    transitionProperty: 'background-color',
    transitionDuration: '125ms',
    ':hover': {
      backgroundColor: 'var(--color-background-muted)',
    },
  },
  placeholder: {
    fontSize: 15,
    color: 'var(--color-text-placeholder)',
  },
  heading: {
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  },
  imageToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  count: {
    fontSize: 12,
    color: 'var(--color-text-secondary)',
  },
  previewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    marginTop: 8,
  },
  previewCell: {
    position: 'relative',
    aspectRatio: '1 / 1',
    overflow: 'hidden',
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-muted)',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 'var(--radius-full)',
    border: 'none',
    cursor: 'pointer',
    color: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    ':hover': {
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
    },
  },
});

type UploadedImage = { id: string; url: string };

export interface ComposerProps {
  userName: string;
  userImage?: string | null;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  hideDefaultTrigger?: boolean;
}

export function Composer({
  userName,
  userImage = null,
  isOpen: controlledOpen,
  onOpenChange: setControlledOpen,
  trigger,
  hideDefaultTrigger = false,
}: ComposerProps) {
  const router = useRouter();
  const toast = useAppToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [content, setContent] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (isControlled) {
        setControlledOpen?.(nextOpen);
      } else {
        setInternalOpen(nextOpen);
      }
    },
    [isControlled, setControlledOpen],
  );

  const pickFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const remaining = MAX_POST_IMAGES - images.length;
    if (remaining <= 0) {
      toast.error(`最多上传 ${MAX_POST_IMAGES} 张图片`);
      return;
    }
    if (files.length > remaining) {
      toast.error(`最多上传 ${MAX_POST_IMAGES} 张图片，已选择前 ${remaining} 张`);
    }
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    try {
      for (const file of toUpload) {
        const fd = new FormData();
        fd.set('file', file);
        fd.set('purpose', 'general');
        fd.set('imageType', 'general');
        const res = await fetch('/api/media/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || !data.ok || !data.media) {
          toast.error(data.error || '图片上传失败');
          continue;
        }
        const media = data.media;
        setImages((prev) =>
          prev.length >= MAX_POST_IMAGES
            ? prev
            : [...prev, { id: media.id, url: media.downloadUrl || media.blobUrl }],
        );
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const submit = async () => {
    if ((!content.trim() && images.length === 0) || loading) return;
    setLoading(true);
    const fd = new FormData();
    fd.set('content', content);
    for (const img of images) {
      fd.append('mediaIds', img.id);
    }
    const res = await createPost(fd);
    setLoading(false);
    if (res?.error) {
      toast.error(res.error);
      return;
    }
    setOpen(false);
    setContent('');
    setImages([]);
    toast.success('已发布，社区居民会看到的');
    router.refresh();
  };

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)} {...stylex.props(styles.trigger)}>
          {trigger}
        </span>
      ) : !hideDefaultTrigger ? (
        <button type="button" onClick={() => setOpen(true)} {...stylex.props(styles.defaultTrigger)}>
          <UserAvatar name={userName} url={userImage} size={40} />
          <span {...stylex.props(styles.placeholder)}>现在在想什么，{userName}？</span>
        </button>
      ) : null}

      <Dialog isOpen={open} onOpenChange={setOpen} purpose="form" width={520}>
        <Layout
          height="auto"
          header={
            <LayoutHeader hasDivider>
              <h2 {...stylex.props(styles.heading)}>发布朋友圈</h2>
            </LayoutHeader>
          }
          content={
            <LayoutContent>
              <TextArea
                label="内容"
                isLabelHidden
                value={content}
                onChange={setContent}
                rows={5}
                maxLength={2000}
                placeholder={`这一刻的想法，${userName}…`}
                htmlName="content"
                hasAutoFocus
              />

              {images.length > 0 && (
                <div {...stylex.props(styles.previewGrid)}>
                  {images.map((img) => (
                    <div key={img.id} {...stylex.props(styles.previewCell)}>
                      <SafeImage src={img.url} alt="待发布图片" xstyle={styles.previewImage} />
                      <button
                        type="button"
                        aria-label="移除图片"
                        onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                        {...stylex.props(styles.removeBtn)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div {...stylex.props(styles.imageToolbar)}>
                <IconButton
                  label="添加图片"
                  variant="ghost"
                  size="sm"
                  icon={<ImagePlus size={18} />}
                  isDisabled={uploading || images.length >= MAX_POST_IMAGES}
                  onClick={() => fileInputRef.current?.click()}
                />
                <span {...stylex.props(styles.count)}>
                  {images.length}/{MAX_POST_IMAGES}
                  {uploading ? ' · 上传中…' : ''}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void pickFiles(e.target.files)}
              />
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <Button label="取消" variant="ghost" onClick={() => setOpen(false)} />
              <Button
                label={loading ? '发布中…' : '发表'}
                variant="primary"
                isDisabled={(!content.trim() && images.length === 0) || loading}
                isLoading={loading}
                onClick={submit}
              />
            </LayoutFooter>
          }
        />
      </Dialog>
    </>
  );
}
