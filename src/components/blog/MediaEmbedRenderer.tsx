import React from 'react';
import { BlogMediaEmbed } from '../../types/blog';
import { Play, ExternalLink, Video, Music2, Share2, Eye } from 'lucide-react';

interface MediaEmbedRendererProps {
  embed: BlogMediaEmbed;
}

export const MediaEmbedRenderer: React.FC<MediaEmbedRendererProps> = ({ embed }) => {
  const { type, url, caption } = embed;

  // Helper extractor for YouTube Video ID
  const getYouTubeEmbedUrl = (rawUrl: string): string | null => {
    try {
      if (rawUrl.includes('youtu.be/')) {
        const id = rawUrl.split('youtu.be/')[1]?.split('?')[0];
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (rawUrl.includes('youtube.com/watch')) {
        const urlObj = new URL(rawUrl);
        const id = urlObj.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (rawUrl.includes('youtube.com/shorts/')) {
        const id = rawUrl.split('youtube.com/shorts/')[1]?.split('?')[0];
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (rawUrl.includes('youtube.com/embed/')) {
        return rawUrl;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Helper extractor for TikTok Video ID
  const getTikTokEmbedUrl = (rawUrl: string): string | null => {
    try {
      const match = rawUrl.match(/video\/(\d+)/);
      if (match && match[1]) {
        return `https://www.tiktok.com/embed/v2/${match[1]}`;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Helper extractor for Instagram Post/Reel
  const getInstagramEmbedUrl = (rawUrl: string): string | null => {
    try {
      // Normalize instagram URL
      let clean = rawUrl.split('?')[0];
      if (!clean.endsWith('/')) clean += '/';
      return `${clean}embed`;
    } catch {
      return null;
    }
  };

  // 1. YouTube Embed
  if (type === 'youtube') {
    const embedUrl = getYouTubeEmbedUrl(url);
    if (embedUrl) {
      return (
        <figure className="my-6 space-y-2.5">
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl">
            <iframe
              src={embedUrl}
              title={caption || 'YouTube Video Player'}
              className="absolute inset-0 w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          {caption && (
            <figcaption className="text-center text-xs text-slate-400 font-medium flex items-center justify-center space-x-1.5">
              <Play className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span>{caption}</span>
            </figcaption>
          )}
        </figure>
      );
    }
  }

  // 2. TikTok Embed
  if (type === 'tiktok') {
    const embedUrl = getTikTokEmbedUrl(url);
    return (
      <figure className="my-6 space-y-2.5 max-w-sm mx-auto">
        <div className="relative w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl min-h-[480px]">
          {embedUrl ? (
            <iframe
              src={embedUrl}
              title={caption || 'TikTok Video Player'}
              className="w-full h-[540px] border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <div className="p-6 text-center flex flex-col items-center justify-center h-64 space-y-3">
              <Music2 className="w-10 h-10 text-cyan-400 animate-pulse" />
              <p className="text-xs text-slate-300 font-bold">Video TikTok Tersemat</p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5"
              >
                <span>Tonton di TikTok</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
        {caption && (
          <figcaption className="text-center text-xs text-slate-400 font-medium flex items-center justify-center space-x-1.5">
            <Music2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>{caption}</span>
          </figcaption>
        )}
      </figure>
    );
  }

  // 3. Instagram Embed
  if (type === 'instagram') {
    const embedUrl = getInstagramEmbedUrl(url);
    return (
      <figure className="my-6 space-y-2.5 max-w-md mx-auto">
        <div className="relative w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl min-h-[420px]">
          {embedUrl ? (
            <iframe
              src={embedUrl}
              title={caption || 'Instagram Post'}
              className="w-full h-[480px] border-0"
              allowTransparency
            />
          ) : (
            <div className="p-6 text-center flex flex-col items-center justify-center h-64 space-y-3">
              <Share2 className="w-10 h-10 text-rose-400" />
              <p className="text-xs text-slate-300 font-bold">Postingan / Reel Instagram</p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-rose-600 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5"
              >
                <span>Buka di Instagram</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
        {caption && (
          <figcaption className="text-center text-xs text-slate-400 font-medium flex items-center justify-center space-x-1.5">
            <Share2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>{caption}</span>
          </figcaption>
        )}
      </figure>
    );
  }

  // 4. Default / Twitter / Custom Fallback Card
  return (
    <figure className="my-6 p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-md flex items-center justify-between gap-4">
      <div className="flex items-center space-x-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
          <Video className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-white truncate">{caption || 'Konten Media Tersemat'}</p>
          <p className="text-[11px] text-slate-400 font-mono truncate">{url}</p>
        </div>
      </div>

      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-xl text-xs font-bold shrink-0 flex items-center space-x-1.5"
      >
        <span>Buka Media</span>
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </figure>
  );
};
