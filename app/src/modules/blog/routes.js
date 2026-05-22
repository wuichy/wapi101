// Router del blog: /blog (index) y /blog/:slug (artículos).
// El sitemap se actualiza desde routes.js de marketing — exponemos
// listPublishedSlugs() para que sea consultable.

const express = require('express');
const { POSTS } = require('./data');
const { renderPost, renderIndex } = require('./render');

module.exports = function createBlogRouter(_db) {
  const router = express.Router();

  // Index: /blog
  router.get('/blog', (_req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=900, s-maxage=3600');
    res.send(renderIndex());
  });

  // Artículo: /blog/<slug>
  router.get('/blog/:slug', (req, res, next) => {
    const post = POSTS[req.params.slug];
    if (!post || post.hidden || post.slug === '_placeholder') return next();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=900, s-maxage=3600');
    res.send(renderPost(post));
  });

  return router;
};
