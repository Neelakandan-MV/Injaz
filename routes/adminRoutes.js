const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const {isLoggedAdmin,isLoggedSuperAdmin} = require('../middlewares/auth');


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
router.post('/admin/addUser',isLoggedSuperAdmin,adminController.addUser);
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
router.get('/admin/expense',isLoggedAdmin,adminController.viewExpense);
router.get('/admin/addExpense',isLoggedAdmin,adminController.viewAddExpense);
router.post('/admin/addExpense',isLoggedAdmin,adminController.addExpense);
router.post('/admin/addExpenseCategory',isLoggedAdmin,adminController.addExpenseCategory);
router.get('/admin/itemWiseProfitAndLoss',isLoggedAdmin,adminController.viewItemProfitAndLoss);
router.get('/admin/cashFlow',isLoggedAdmin,adminController.viewCashFlow);
router.get('/admin/dayBook',isLoggedAdmin,adminController.viewDayBook);
router.get('/admin/viewParty',isLoggedAdmin,adminController.viewParty);
router.post('/admin/addParty',isLoggedAdmin,adminController.addParty);
router.get('/admin/updatePartyStatus',isLoggedAdmin,adminController.togglePartyStatus);
router.get('/admin/viewStockReport',isLoggedAdmin,adminController.viewStockReport);
router.get('/admin/adjustStock',isLoggedAdmin,adminController.viewAdjustStock);
router.get('/admin/adjustStockDetails',isLoggedAdmin,adminController.viewAdjustStockDetails);
router.post('/admin/adjustStock',isLoggedAdmin,adminController.adjustStock);
router.get('/admin/editItems',isLoggedAdmin,adminController.viewEditItems);
router.post('/admin/editItems',isLoggedAdmin,adminController.editItems);
  

module.exports = router;
