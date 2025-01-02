const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const User = require('../models/userModel')
const bcrypt = require('bcryptjs');


// Admin dashboard
router.get('/admin/dashboard', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  res.render('admin/dashboard.ejs',{title:'Admin Dashboard'})
});

router.get('/admin/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.redirect('/admin/dashboard'); 
      }
      res.clearCookie('connect.sid'); 
      res.redirect('/'); 
    });
  });

  

module.exports = router;
