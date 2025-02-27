const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const {isLoggedAdmin,isLoggedSuperAdmin} = require('../middlewares/auth');

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });


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
router.get('/admin/addSale',isLoggedAdmin,adminController.viewAddSale);
router.get('/admin/addPurchase',isLoggedAdmin,adminController.viewAddPurchase);
router.post('/admin/addTransactions',isLoggedAdmin,adminController.addTransaction);
router.get('/admin/transactionEdit',isLoggedAdmin,adminController.viewtransactionEdit);
router.get('/admin/transactionDetails',isLoggedAdmin,adminController.transactionDetails);
router.post('/admin/transactionEdit',isLoggedAdmin,adminController.transactionEdit);
router.get('/admin/transactionDelete',isLoggedAdmin,adminController.transactionDelete);
router.get('/admin/reports',isLoggedAdmin,adminController.viewReports);
router.get('/admin/expense',isLoggedAdmin,adminController.viewExpense);
router.get('/admin/otherIncome',isLoggedAdmin,adminController.viewIncome);
router.get('/admin/addExpense',isLoggedAdmin,adminController.viewAddExpense);
router.get('/admin/addIncome',isLoggedAdmin,adminController.viewAddIncome);
router.post('/admin/addIncome',isLoggedAdmin,adminController.addIncome);
router.post('/admin/addExpense',isLoggedAdmin,adminController.addExpense);
router.post('/admin/addExpenseCategory',isLoggedAdmin,adminController.addExpenseCategory);
router.post('/admin/addIncomeCategory',isLoggedAdmin,adminController.addIncomeCategory);
router.get('/admin/itemWiseProfitAndLoss',isLoggedAdmin,adminController.viewItemProfitAndLoss);
router.get('/admin/item-detail',isLoggedAdmin,adminController.viewItemDetail);
router.get('/admin/cashFlow',isLoggedAdmin,adminController.viewCashFlow);
router.get('/admin/dayBook',isLoggedAdmin,adminController.viewDayBook);
router.get('/admin/viewParty',isLoggedAdmin,adminController.viewParty);
router.get('/admin/viewParties',isLoggedAdmin,adminController.viewParties);
router.post('/admin/addParty',isLoggedAdmin,adminController.addParty);
router.get('/admin/updatePartyStatus',isLoggedAdmin,adminController.togglePartyStatus);
router.get('/admin/deleteParty',isLoggedAdmin,adminController.deleteParty);
router.get('/admin/editParty',isLoggedAdmin,adminController.viewEditParty);
router.post('/admin/editParty',isLoggedAdmin,adminController.editParty);
router.get('/admin/viewStockReport',isLoggedAdmin,adminController.viewStockReport);
router.get('/admin/adjustStock',isLoggedAdmin,adminController.viewAdjustStock);
router.get('/admin/adjustStockDetails',isLoggedAdmin,adminController.viewAdjustStockDetails);
router.post('/admin/adjustStock',isLoggedAdmin,adminController.adjustStock);
router.get('/admin/editItems',isLoggedAdmin,adminController.viewEditItems);
router.post('/admin/editItems',isLoggedAdmin,adminController.editItems);
router.get('/admin/cashInHand',isLoggedAdmin,adminController.viewCashInHand);
router.get('/admin/totalReceivable',isLoggedAdmin,adminController.totalReceivable);
router.get('/admin/totalPayable',isLoggedAdmin,adminController.totalPayable);
router.post('/admin/return',isLoggedAdmin,adminController.itemReturn);
router.post('/admin/add-contacts',adminController.addContacts);
router.get('/admin/adjustCash',isLoggedAdmin,adminController.viewAdjustCash);
router.post('/admin/adjustCash',isLoggedAdmin,adminController.adjustCash);
router.get('/admin/addPaymentIn',isLoggedAdmin,adminController.viewAddPaymentIn);
router.post('/admin/addPaymentIn',isLoggedAdmin,adminController.addPaymentIn);
router.get('/admin/addPaymentOut',isLoggedAdmin,adminController.viewAddPaymentOut);
router.post('/admin/addPaymentOut',isLoggedAdmin,adminController.addPaymentOut);
router.get('/admin/exchange-rates',isLoggedAdmin,adminController.viewexchangeRates);
router.post('/admin/exchange-rates',isLoggedAdmin,adminController.updateExchangeRates);
router.get('/api/getExchange-rates',adminController.getExchangeRate)
router.get('/admin/profitAndLoss',isLoggedAdmin,adminController.viewProfitAndLoss)
router.get('/admin/partyTransactions',isLoggedAdmin,adminController.viewPartyTransactions)
router.get('/admin/delivered',isLoggedAdmin,adminController.viewTotalDelivered)
router.get('/admin/deliveryDetails',isLoggedAdmin,adminController.viewDeliveryDetails)
router.get('/admin/deliveryUpdates',isLoggedAdmin,adminController.viewDeliveryUpdates)
router.get('/admin/editUser',isLoggedAdmin,adminController.viewEditUser)
router.post('/admin/editUser',isLoggedAdmin,adminController.editUser)
router.get('/admin/paymentEdit',isLoggedAdmin,adminController.viewPaymentEdit)
router.post('/admin/paymentEdit',isLoggedAdmin,adminController.paymentEdit)
router.get('/admin/expenseEdit',isLoggedAdmin,adminController.viewExpenseEdit)
router.post('/admin/expenseEdit',isLoggedAdmin,adminController.expenseEdit)
router.get('/admin/incomeEdit',isLoggedAdmin,adminController.viewIncomeEdit)
router.post('/admin/incomeEdit',isLoggedAdmin,adminController.incomeEdit)
router.post('/admin/store-access-token',adminController.storeAccessToken)
router.post('/admin/uploadContactFile',upload.single('contact'),adminController.importContacts)
router.get('/admin/manageCompanies',isLoggedAdmin,adminController.viewManageCompanies)
router.delete('/admin/deleteCompany',isLoggedAdmin,adminController.deleteCompany)
router.get('/admin/editAdjustCash',isLoggedAdmin,adminController.viewCashInHandAdjustEdit)
router.post('/admin/editAdjustCash',isLoggedAdmin,adminController.cashInHandAdjustEdit)
router.get('/admin/itemReportByParty',isLoggedAdmin,adminController.viewItemReportByParty)
router.get('/admin/removeProduct',isLoggedAdmin,adminController.removeProductFromTrasaction)

  

module.exports = router;
