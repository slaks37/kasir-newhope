import React, { useEffect } from 'react';
import { BlogPost } from '../../types/blog';

interface BlogSEOHeadProps {
  post?: BlogPost;
  isListPortal?: boolean;
}

export const BlogSEOHead: React.FC<BlogSEOHeadProps> = ({ post, isListPortal = false }) => {
  useEffect(() => {
    // Helper to safely set meta tag
    const setMetaTag = (attrName: 'name' | 'property', attrValue: string, contentValue: string) => {
      let element = document.querySelector(`meta[${attrName}="${attrValue}"]`) as HTMLMetaElement;
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attrName, attrValue);
        document.head.appendChild(element);
      }
      element.setAttribute('content', contentValue);
    };

    // Helper to set canonical link
    const setCanonicalLink = (url: string) => {
      let element = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
      if (!element) {
        element = document.createElement('link');
        element.setAttribute('rel', 'canonical');
        document.head.appendChild(element);
      }
      element.setAttribute('href', url);
    };

    // Helper to inject JSON-LD schema
    const setStructuredData = (id: string, json: object) => {
      let script = document.getElementById(id) as HTMLScriptElement;
      if (!script) {
        script = document.createElement('script');
        script.id = id;
        script.type = 'application/ld+json';
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(json);
    };

    if (isListPortal || !post) {
      // SEO for Blog Harapan Baru Portal Homepage
      const portalTitle = 'Blog Harapan Baru — Tips Bisnis, Panduan Kasir & FinTech UMKM | New Hope POS';
      const portalDesc = 'Portal edukasi resmi New Hope POS: Panduan membuka kafe, tips bisnis laundry kiloan, tutorial QRIS Dinamis, dan strategi kontrol resep HPP bahan baku.';
      const portalKeywords = 'blog bisnis umkm, tips buka kafe, aplikasi kasir terbaik, qris dinamis pos, resep hpp, harapan baru pos';
      const canonical = 'https://newhopepos.com/#blog';

      document.title = portalTitle;
      setMetaTag('name', 'description', portalDesc);
      setMetaTag('name', 'keywords', portalKeywords);
      setMetaTag('name', 'robots', 'index, follow');
      setMetaTag('property', 'og:title', portalTitle);
      setMetaTag('property', 'og:description', portalDesc);
      setMetaTag('property', 'og:type', 'website');
      setMetaTag('property', 'og:url', canonical);
      setMetaTag('property', 'og:image', 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&q=80&w=1200');
      setMetaTag('name', 'twitter:card', 'summary_large_image');
      setMetaTag('name', 'twitter:title', portalTitle);
      setMetaTag('name', 'twitter:description', portalDesc);
      setCanonicalLink(canonical);

      // JSON-LD for Portal
      setStructuredData('blog-portal-schema', {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: 'Blog Harapan Baru - New Hope POS',
        url: canonical,
        description: portalDesc,
        publisher: {
          '@type': 'Organization',
          name: 'New Hope POS',
          url: 'https://newhopepos.com',
          logo: 'https://newhopepos.com/assets/logo.png',
        },
      });

      return;
    }

    // SEO for Specific Article Detail Page
    const pageTitle = `${post.seo?.metaTitle || post.title} | Blog Harapan Baru - New Hope POS`;
    const pageDesc = post.seo?.metaDescription || post.excerpt;
    const pageKeywords = (post.seo?.metaKeywords || post.tags || []).join(', ');
    const canonical = post.seo?.canonicalUrl || `https://newhopepos.com/#blog/${post.slug}`;
    const ogImage = post.seo?.ogImage || post.coverImage;

    document.title = pageTitle;
    setMetaTag('name', 'description', pageDesc);
    setMetaTag('name', 'keywords', pageKeywords);
    setMetaTag('name', 'author', post.author?.name || 'New Hope POS Editorial Team');
    setMetaTag('name', 'robots', 'index, follow, max-image-preview:large');
    setMetaTag('property', 'og:title', pageTitle);
    setMetaTag('property', 'og:description', pageDesc);
    setMetaTag('property', 'og:type', 'article');
    setMetaTag('property', 'og:url', canonical);
    setMetaTag('property', 'og:image', ogImage);
    setMetaTag('property', 'article:published_time', post.createdAt);
    setMetaTag('property', 'article:modified_time', post.updatedAt);
    setMetaTag('property', 'article:section', post.category);
    setMetaTag('name', 'twitter:card', 'summary_large_image');
    setMetaTag('name', 'twitter:title', pageTitle);
    setMetaTag('name', 'twitter:description', pageDesc);
    setMetaTag('name', 'twitter:image', ogImage);
    setCanonicalLink(canonical);

    // Rich Snippet JSON-LD for Google Search Article Schema
    setStructuredData('blog-post-schema', {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': canonical,
      },
      headline: post.title,
      description: post.excerpt,
      image: [ogImage],
      datePublished: post.createdAt,
      dateModified: post.updatedAt,
      author: {
        '@type': 'Person',
        name: post.author?.name || 'New Hope Editorial',
        jobTitle: post.author?.role || 'Business Consultant',
      },
      publisher: {
        '@type': 'Organization',
        name: 'New Hope POS',
        url: 'https://newhopepos.com',
        logo: {
          '@type': 'ImageObject',
          url: 'https://newhopepos.com/assets/logo.png',
        },
      },
      articleSection: post.category,
      keywords: pageKeywords,
      wordCount: post.content?.split(/\s+/).length || 500,
    });
  }, [post, isListPortal]);

  return null;
};
