const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const {isLoggedAdmin} = require('../middlewares/auth');


// Admin dashboard

router.get('/admin/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.redirect('/admin/dashboard'); 
      }
      res.clearCookie('connect.sid'); 
      res.redirect('/'); 
    });
  });


router.get('/admin/dashboard',isLoggedAdmin,adminController.viewDashboard);
router.get('/admin/sales',isLoggedAdmin,adminController.viewSales);
router.get('/admin/purchases',isLoggedAdmin,adminController.viewPurchases);
router.get('/admin/transactions',isLoggedAdmin,adminController.viewTransactions);
router.get('/admin/userManagement',isLoggedAdmin,adminController.viewUser);
router.post('/admin/addUser',isLoggedAdmin,adminController.addUser);
router.put('/admin/deleteUser/:id',isLoggedAdmin,adminController.userBlock);
router.get('/admin/logout',isLoggedAdmin,adminController.logout);
router.get('/admin/sales',isLoggedAdmin,adminController.viewSales);
router.post('/admin/addCompany',isLoggedAdmin,adminController.addCompany);
router.get('/admin/switchCompany/:id',isLoggedAdmin,adminController.switchCompany);
router.get('/admin/viewItems',isLoggedAdmin,adminController.viewItems);
router.get('/admin/addItems',isLoggedAdmin,adminController.viewAddItems);
router.post('/admin/addItems',isLoggedAdmin,adminController.AddItems);
router.post('/admin/addCategory',isLoggedAdmin,adminController.addCategory);
router.get('/admin/addTransactions',isLoggedAdmin,adminController.viewAddTransaction);
router.post('/admin/addTransactions',isLoggedAdmin,adminController.addTransaction);
router.get('/admin/reports',isLoggedAdmin,adminController.viewReports);

// router.get('/business-owner/viewParty',isLogged,businessController.viewParty);
// router.get('/business-owner/logout',isLogged,businessController.logout);
// router.get('/register',businessController.viewRegister)
// router.post('/register',businessController.handleRegister)

  

module.exports = router;
