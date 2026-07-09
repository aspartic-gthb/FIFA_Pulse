'use strict';

const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Serve static frontend
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Redirect /analytics to /
app.get('/analytics', (req, res) => {
  res.redirect('/');
});

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.listen(PORT, () => {
  console.log(`FIFA Pulse Analytics Website running on http://localhost:${PORT}`);
});

module.exports = app;
