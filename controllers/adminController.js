const mysql = require('../mySql');
const multer = require('multer');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Set up storage for uploaded images
var storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './uploads');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix);
    }
});

var upload = multer({
    storage: storage,
}).single("image");


const getOpeningCash = async (date, companyId) => {
    const [result] = await mysql.query(
        `SELECT closing_cash FROM cash_flows
         WHERE date < ? AND company_id = ?
         ORDER BY date DESC LIMIT 1`,
        [date, companyId]
    );
    return result.length > 0 ? result[0].closing_cash : 0;
};

const calculateClosingCash = async (openingCash, date, companyId) => {
    const [inflows] = await mysql.query(
        `SELECT SUM(amount) AS inflow FROM cash_flows
         WHERE date = ? AND tnx_type = 'purchase' AND company_id = ?`,
        [date, companyId]
    );
    const [outflows] = await mysql.query(
        `SELECT SUM(amount) AS outflow FROM cash_flows
         WHERE date = ? AND tnx_type = 'sale' AND company_id = ?`,
        [date, companyId]
    );
    const inflow = inflows[0]?.inflow || 0;
    const outflow = outflows[0]?.outflow || 0;

    return Number(openingCash) + inflow - outflow;
};


async function resetStockOnTransactionDeletion(transactionId, transactionType,user) {
    
    // Fetch products related to the transaction
    const [products] = await mysql.query(
      "SELECT * FROM sale_products WHERE sale_id = ?",
      [transactionId]
    );
  
    // Loop through each product and update the items stock
    for (const product of products) {
      // For a sale, add back the sold quantity; for a purchase, subtract the purchased quantity.
      const adjustment = product.quantity;
      if (transactionType === 'sale') {
        // If a sale is being deleted, add back the quantity to stock
        await mysql.query(
          "UPDATE items SET stock = stock + ? WHERE id = ?",
          [adjustment, product.item_id]
        );
        await mysql.query(`INSERT INTO stock_adjustments (item_id,adjustment_type,adjustment_quantity, total_amount,reason,company_id) VALUES (?,?,?,?,?,?)`,[product.item_id,'add',adjustment,'0','due to deletion',user.company_id])
      } else if (transactionType === 'purchase') {
        // If a purchase is being deleted, remove the quantity from stock
        await mysql.query(
          "UPDATE items SET stock = stock - ? WHERE id = ?",
          [adjustment, product.item_id]
        );
        await mysql.query(`INSERT INTO stock_adjustments (item_id,adjustment_type,adjustment_quantity, total_amount,reason,company_id) VALUES (?,?,?,?,?,?)`,[product.item_id,'reduce',adjustment,'0','due to deletion',user.company_id])
      }
    }
  }
  




const adminController = {

    viewDashboard: async (req, res) => {
        const user = req.session.user;
        const apiKey = process.env.EXCHANGE_RATE_API_KEY;
        

        try {
            let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

            const companyId = user.company_id;

            if (!companyId) {
                return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
            }

            const [partyWisePayable] = await mysql.query(`
                SELECT 
                    p.id AS party_id,
                    p.PartyName AS party_name,
                    SUM(p.payable) AS total_payable
                FROM 
                    parties p
                WHERE 
                    p.company_id = ?
            `, [companyId]);

            const [partyWiseReceivable] = await mysql.query(`
                SELECT 
                    p.id AS party_id,
                    p.PartyName AS party_name,
                    SUM(p.receivable) AS total_receivable
                FROM 
                    parties p
                WHERE 
                    p.company_id = ?
            `, [companyId]);

            //checking
            const [partyWiseToPay] = await mysql.query(
                `SELECT p.id AS party_id,
                p.PartyName AS party_name,
                p.to_receive AS total_to_pay
                FROM 
                    parties p
                WHERE 
                    p.company_id = ? AND
                    p.to_receive <0
                `,[companyId])

            const [partyWiseToReceive] = await mysql.query(
                `SELECT p.id AS party_id,
                p.PartyName AS party_name,
                p.to_receive AS total_to_receive
                FROM 
                    parties p
                WHERE 
                    p.company_id = ? AND
                    p.to_receive >0
                `,[companyId])
                


            const totalToPay = partyWiseToPay.reduce((acc, transaction) => {
                    return acc+Number(transaction.total_to_pay)
            }, 0);
            const totalToReceive = partyWiseToReceive.reduce((acc, transaction) => {
                    return acc+Number(transaction.total_to_receive)
            }, 0);


            const totalPayable = partyWisePayable.reduce((acc, transaction) => {
                    return acc+Number(transaction.total_payable)
            }, 0);

            const totalReceivable = partyWiseReceivable.reduce((acc, transaction) => {
                return acc+Number(transaction.total_receivable)
            }, 0);

            // const [totalCashInHand] = await mysql.query(`
            //     SELECT 
            //         company_id, 
            //         user_id, 
            //         SUM(cash_flow) AS cash_in_hand
            //     FROM (
            //         -- Cash flow from sales
            //         SELECT 
            //             company_id, 
            //             user_id, 
            //             CASE 
            //                 WHEN transaction_type = 'sale' THEN received_amount 
            //                 WHEN transaction_type = 'purchase' THEN -received_amount 
            //                 ELSE 0 
            //             END AS cash_flow
            //         FROM 
            //             sales 
            //         WHERE 
            //             payment_type = 'Cash'
            
            //         UNION ALL
            
            //         -- Cash flow from expenses
            //         SELECT 
            //             company_id, 
            //             NULL AS user_id, 
            //             -amount AS cash_flow
            //         FROM 
            //             expenses
            //     ) AS combined_cash_flows
            //     WHERE company_id = ?
            //     GROUP BY company_id
            // `, [companyId]);

            const totalCashInHand = currentCompany[0].cash_in_hand;


            const [items] = await mysql.query(`
                SELECT items.*, categories.category AS categoryName 
                FROM items 
                LEFT JOIN categories ON items.category_id = categories.id
                WHERE items.company_id = ?
            `, [companyId]);
    
            const stockValue = items.reduce((accumulator, item) => {
                return accumulator + Number(item.purchase_price) * Number(item.stock);
            }, 0);


            const [totalDelivered] = await mysql.query(`SELECT SUM(delivered_quantity) AS total_delivered_products, SUM(quantity - delivered_quantity) AS total_pending_products FROM sale_products WHERE company_id = ?`,[user.company_id])            

            res.render('admin/dashboard.ejs', {
                title: "Admin Dashboard",
                totalCashInHand,
                totalPayable:Math.abs(totalToPay),
                totalReceivable:totalToReceive,
                stockValue,
                currentCompany,
                companies,
                apiKey,
                totalDelivered:totalDelivered[0],
                user
            });
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            res.render('admin/error.ejs', { error: 'An error occurred while fetching the dashboard data.' });
        }
    },


    viewSales: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        let companies = []
        if(user.role == 'superAdmin'){
            [companies] = await mysql.query(`SELECT * FROM companies`);
        }else{
            [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const [items] = await mysql.query(`
            SELECT 
                sales.*, 
                parties.PartyName AS customer_name,
                COALESCE(SUM(sale_products.quantity), 0) AS total_quantity,
                COALESCE(SUM(sale_products.delivered_quantity), 0) AS total_delivered_quantity
            FROM 
                sales
            LEFT JOIN 
                parties ON sales.customer_name = parties.id
            LEFT JOIN 
                sale_products ON sales.id = sale_products.sale_id
            WHERE 
                sales.company_id = ? 
                AND sales.transaction_type = 'sale'
            GROUP BY 
                sales.id, parties.PartyName
            ORDER BY
        sales.date DESC, sales.id DESC
        `, [companyId]);

        

        res.render("admin/sales.ejs", { title: "Sales", items, currentCompany, companies, user });
    },

    transactionDelete: async (req, res) => {

        const user = req.session.user
        const transaction_id = req.query.id
        const [transaction] = await mysql.query(`SELECT * FROM sales WHERE id = ?`,[transaction_id])
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[transaction[0].customer_name])
        let payable = Number(party[0].payable)
        let receivable = Number(party[0].receivable)
        let balance_due = Number(transaction[0].balance_due)

        //checking
        let to_receive = Number(party[0].to_receive)
        if(transaction[0].transaction_type == 'sale'){
            to_receive -= Number(transaction[0].balance_due)
        }else{
            to_receive += Number(transaction[0].balance_due)
        }
        //

        if(transaction[0].transaction_type == 'sale'){

            if(receivable >= 0 ){
                if(receivable > balance_due){
                    receivable -= balance_due
                }else{
                    payable += (balance_due-receivable)
                    receivable = 0
                }
            }else{
                payable += balance_due
            }
        }else{

            if(payable >= 0 ){
                if(payable > balance_due){
                    payable -= balance_due
                }else{
                    receivable += (balance_due-payable)
                    payable = 0
                }
            }else{
                receivable += balance_due
            }
        }
        await mysql.query(`UPDATE parties SET receivable = ?, payable = ?, to_receive = ? WHERE id = ?`,[receivable,payable, to_receive,transaction[0].customer_name])

        await resetStockOnTransactionDeletion(transaction_id,transaction[0].transaction_type,user)
        
        if(transaction[0].transaction_type == "sale"){
            await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand - ? WHERE id=?`,[transaction[0].received_amount,user.company_id])
        }else{
            await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand + ? WHERE id=?`,[transaction[0].received_amount,user.company_id])
        }

        await mysql.query(`DELETE FROM cash_flows WHERE tnx_id = ?`, [transaction_id]);
        await mysql.query(`DELETE FROM delivery_details WHERE sale_id = ?`,[transaction_id])
        await mysql.query(`DELETE FROM sale_products WHERE sale_id = ?`, [transaction_id]);
        await mysql.query(`DELETE FROM sales WHERE id = ?`, [transaction_id]);
        res.redirect('/admin/dashboard')
    },
    transactionDetails: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const transaction_id = req.query.id
        const previousRoute = res.locals.previousRoute
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [transactionDetails] = await mysql.query(`SELECT * FROM sales WHERE id = ?`, [transaction_id])
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[transactionDetails[0].customer_name])
        const [transactionProducts] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id = ?`, [transaction_id])

        res.render('admin/transactionDetails', { user, currentCompany, companies, transactionDetails: transactionDetails[0], transactionProducts, previousRoute,party:party[0] })
    },


     viewPurchases: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        let companies = []
        if(user.role == 'superAdmin'){
            [companies] = await mysql.query(`SELECT * FROM companies`);
        }else{
            [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const [items] = await mysql.query(`
            SELECT 
                sales.*, 
                parties.PartyName AS customer_name
            FROM 
                sales
            LEFT JOIN 
                parties ON sales.customer_name = parties.id
            WHERE 
                sales.company_id = ? 
                AND sales.transaction_type = 'purchase'
        `, [companyId]);
        res.render("admin/purchases.ejs", { title: "Sales", items, currentCompany, companies, user });
    },

    viewTransactions: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        let companies = []
        if(user.role == 'superAdmin'){
            [companies] = await mysql.query(`SELECT * FROM companies`);
        }else{
            [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;
        const [transactions] = await mysql.query(`
            SELECT 
                s.id, 
                s.invoice_number, 
                s.customer_name, 
                s.total_amount, 
                s.balance_due, 
                s.payment_type, 
                s.received_amount,
                s.transaction_type, 
                DATE_FORMAT(s.date, '%Y-%m-%d') AS date,
                parties.PartyName AS customer_name
            FROM sales s
            LEFT JOIN
            parties ON s.customer_name = parties.id
            WHERE s.company_id = ?
            ORDER BY date DESC
            LIMIT ? OFFSET ?
        `, [companyId, parseInt(limit), offset]);

        const countResults = await mysql.query(`SELECT COUNT(*) AS total FROM sales;`)
        const totalTransactions = countResults[0].total;
        const totalPages = Math.ceil(totalTransactions / limit);
        res.render('admin/transactions.ejs', {
            transactions,
            totalTransactions,
            totalPages,
            currentPage: parseInt(page),
            limit: parseInt(limit),
            currentCompany,companies,
            user
        });
    },

    viewtransactionEdit: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const transaction_id = req.query.id
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [transactionDetails] = await mysql.query(`SELECT * FROM sales WHERE id = ?`, [transaction_id])
        const [transactionProducts] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id = ?`, [transaction_id])
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE company_id`, [user.company_id]);
        const products = await mysql.query("SELECT * FROM items WHERE company_id = ?", [companyId])
        const [current_party] = await mysql.query('SELECT * FROM parties WHERE id = ?', transactionDetails[0].customer_name)
        const previousRoute = res.locals.previousRoute

        res.render('admin/transactionEdit.ejs', { user, currentCompany, companies, transactionDetails: transactionDetails[0], transactionProducts, parties, products: products[0], current_party: current_party[0], previousRoute,user })
    },
    transactionEdit: async (req, res) => {
        let { partyName, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, transactionType, transaction_id, } = req.body;
        const products = req.body.products;
        const user = req.session.user;
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id=?`, [partyName])
        const [currentProductsInTransactions] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id=?`,[transaction_id])
        const [transactionDetails] = await mysql.query(`SELECT * FROM sales WHERE id = ?`, [transaction_id])

        if(Number(recieved) >= Number(totalAmount)){
            paymentType = 'Cash';
        }

        if(Number(transactionDetails[0].balance_due) != Number(balanceDue)){
            let payable = Number(party[0].payable);
            let receivable = Number(party[0].receivable);
            const balance = Math.abs(Number(balanceDue) - Number(transactionDetails[0].balance_due));


            //checking
            let to_receive = Number(party[0].to_receive)
            if(transactionType == 'purchase'){

                to_receive += Number(transactionDetails[0].balance_due)
                to_receive -= Number(balanceDue)

            }else{

                to_receive -= Number(transactionDetails[0].balance_due)
                to_receive += Number(balanceDue)

            }
            //

            if (transactionType === "purchase") {
                if (receivable > 0) {
                    if (receivable >= balance) {
                        receivable -= balance;
                    } else {
                        payable += balance - receivable;
                        receivable = 0;
                    }
                } else {
                    if(balance <= payable){
                        receivable += (balance - payable)
                        payable = 0
                    }else{
                        payable += balance;
                    }
                }
            } else { // Sale transaction
                if (payable > 0) {
                    if (payable >= balance) {
                        payable -= balance;
                    } else {
                        receivable += balance - payable;
                        payable = 0;
                    }
                } else { 
                    if(balance >= receivable){
                    payable += (balance - receivable)
                    receivable = 0
                }else{
                    receivable -= balance;
                }
                }
            }
            
            // Update the party's payable and receivable
            await mysql.query(
                `UPDATE parties SET payable = ?, receivable = ?, to_receive = ? WHERE id = ?`,
                [payable, receivable, to_receive, partyName]
            ); 
        }
        //cashflow updating
            await mysql.query(`UPDATE cash_flows SET name =?, date=?,amount=? WHERE tnx_id = ?`,
                [party[0].PartyName,date,recieved,transactionDetails[0].id])

        
        await mysql.query(`
            UPDATE sales 
            SET 
                customer_name = ?, 
                date = ?, 
                invoice_number = ?, 
                payment_type = ?, 
                total_amount = ?, 
                received_amount = ?, 
                balance_due = ?, 
                transaction_type = ? 
            WHERE id = ?`,
            [partyName, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, transactionType, transaction_id]
        );
        

// 
if (products && products.length) {
    for (let [i, product] of products.entries()) {
      // Check if this product already exists in the sale (i.e. has a saleProduct_id)
      if (product.saleProduct_id) {
        // Process update for existing product
        await mysql.query(`
            UPDATE sale_products
            SET  
                item_id = ?, 
                quantity = ?, 
                delivered_quantity = ?,
                price = ?, 
                discount = ?, 
                tax_rate = ?, 
                total = ?, 
                company_id = ?, 
                product_name = ?, 
                unit = ?,
                serial_number = ?
            WHERE id = ?`,
          [
            product.itemId,
            product.quantity,
            product.deliveredQuantity,
            product.pricePerUnit,
            product.discount,
            product.tax,
            product.productTotal,
            user.company_id,
            product.item,
            product.unit,
            product.serial_number,
            product.saleProduct_id
          ]
        );
        if(transactionType == 'sale'){
        // Find the matching current product (if available)
            const currentProduct = currentProductsInTransactions.find(p => p.id == product.saleProduct_id);
            if (currentProduct) {
                if (Number(currentProduct.delivered_quantity) !== Number(product.deliveredQuantity)) {
                    await mysql.query(
                    `INSERT INTO delivery_details (sale_id, sale_product_id, delivery_date, delivered_quantity, company_id, item_id, notes ,serial_number)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        currentProduct.sale_id,
                        currentProduct.id,
                        created_at,
                        Number(product.deliveredQuantity) - Number(currentProduct.delivered_quantity),
                        user.company_id,
                        currentProduct.item_id,
                        `Delivery updated from ${currentProduct.delivered_quantity} to ${product.deliveredQuantity} on ${created_at}`,
                        product.serial_number
                    ]
                    );
                }
            }
        }
      } else {
        // NEW ITEM: This covers cases where a new item is inserted in between.
        // (Even if products.length > currentProductsInTransactions.length, 
        // this condition ensures we catch products without saleProduct_id.)
        
        // Insert a new sale_product record:
        const [new_sale_product] = await mysql.query(`
            INSERT INTO sale_products (
                item_id, 
                sale_id,
                quantity, 
                delivered_quantity,
                price, 
                discount, 
                tax_rate, 
                total, 
                company_id, 
                product_name, 
                unit,
                serial_number
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ? ,?, ?)`,
          [
            product.itemId,
            transaction_id,
            product.quantity,
            product.deliveredQuantity,
            product.pricePerUnit,
            product.discount,
            product.tax,
            product.productTotal,
            user.company_id,
            product.item,
            product.unit,
            product.serial_number ||0
          ]
        );
        
        // Optionally, update product.saleProduct_id here if needed for subsequent processing
        product.saleProduct_id = new_sale_product.insertId;
        
        // Then, if it's a sale transaction, insert into delivery_details:
        if (transactionType === 'sale') {
          await mysql.query(
            `INSERT INTO delivery_details (sale_id, sale_product_id, delivery_date, delivered_quantity, company_id, item_id, notes, serial_number)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              transaction_id,
              new_sale_product.insertId,
              created_at,
              product.deliveredQuantity,
              user.company_id,
              product.itemId,
            "New Product and delivery added by editing a sale",
            product.serial_number

            ]
          );
        }
      }
    }
  }
  
// 

let current_received = transactionDetails[0].received_amount

if(Number(current_received) != Number(recieved)){
    if (transactionType === "purchase") {
        await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand - ? WHERE id = ?`,[Number(recieved ||0) - Number(current_received||0),user.company_id]);
    }else{
        await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand + ? WHERE id = ?`,[Number(recieved ||0) - Number(current_received||0),user.company_id]);
    }
}
        
        if (transactionType === "purchase") {
            return res.redirect('/admin/purchases');
        }
        res.redirect('/admin/sales');
    },
    removeProductFromTrasaction:async(req,res)=>{
        const {id,quantity} = req.query
        const [sale_item] = await mysql.query(`SELECT * FROM sale_products WHERE id=?`,[id])
        const item_id = sale_item[0]?.item_id
        await mysql.query(`UPDATE items set stock = stock - ? WHERE id=?`,[quantity,item_id])
        if(id){
        await mysql.query(`DELETE FROM delivery_details WHERE sale_product_id = ?`,[id])
        await mysql.query(`DELETE FROM sale_products WHERE id = ?`, [id]);
        res.json({success:'Removed From Transaction History'})
        }
        
    },

    viewUser: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const currentUser = req.session.user;
        const [users] = await mysql.query("SELECT * FROM users WHERE role != 'superAdmin'")
        const [superUser] = await mysql.query("SELECT * FROM users WHERE role = 'superAdmin'")
        res.render('admin/manageUsers.ejs', { users, currentUser, companies,currentCompany,user,superUser })
    },

    addUser: async (req, res) => {
        const {data,companies} = req.body        
        const hashedPassword = await bcrypt.hash(data.password, 10);
        const companyJSON = JSON.stringify(companies)

        const [userExists] = await mysql.query("SELECT * FROM users WHERE email = ?", [data.userEmail])
        if(!userExists.length){
            await mysql.query("INSERT INTO users (name,email,password,role,available_companies) VALUES (?,?,?,?,?)", [data.userName, data.userEmail, hashedPassword, data.role,companyJSON])
            res.json({success:true})
        }else{
            return res.status(404).json({error:'User already exists'});
        }
        
        
        // await mysql.query("INSERT INTO companies (user_id,name,created_at) VALUES (?,?,?)", [addedUser[0].id, 'Main', new Date()])
        // res.redirect('/admin/userManagement')
        
    },
    userBlock: async (req, res) => {
        const id = req.params.id
        const [user] = await mysql.query("SELECT * FROM users WHERE id = ?", [id])
        if (user[0].isActive) {
            await mysql.query("UPDATE users SET isActive = false WHERE id = ?", [id])
        } else {
            await mysql.query("UPDATE users SET isActive = true WHERE id = ?", [id])
        }
        res.json({ success: true })
    },
    logout: (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    },

    viewAddItems: async (req, res) => {
        const user = req.session.user;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        const companyId = user.company_id;

        if (!companyId) {
            return res.render("admin/error.ejs", { error: 'No company found for this user.' });
        }

        const [categories] = await mysql.query("SELECT * FROM categories");



        res.render('admin/addItems.ejs', { categories: categories.length > 0 ? categories : [] ,currentCompany,companies,user});
    },

    // Add new item, associating it with the company
    AddItems: async (req, res) => {
        upload(req, res, async function (err) {
            if (err instanceof multer.MulterError) {
                return res.status(500).json(err);
            } else if (err) {
                return res.status(500).json(err);
            }
            const user = req.session.user;
            const companyId = user.company_id;

            if (!companyId) {
                return res.render("admin/error.ejs", { error: 'No company found for this user.' });
            }

            const {
                itemName,
                itemHSN,
                category,
                unit,
                salePrice,
                salePriceTaxIncluded,
                discountValue,
                discountType,
                wholesaleQuantity1,
                wholesalePrice1,
                wholesaleQuantity2,
                wholesalePrice2,
                wholesaleQuantity3,
                wholesalePrice3,
                serviceChargeQuantity1,
                serviceCharge1,
                serviceChargeQuantity2,
                serviceCharge2,
                serviceChargeQuantity3,
                serviceCharge3,
                purchasePrice,
                purchasePriceTaxIncluded,
                taxRate,
                itemCode
            } = req.body;

            const image = req.file ? req.file.filename : null;

            try {

                const [itemExist] = await mysql.query(
                    "SELECT * FROM items WHERE item_name = ? AND company_id = ?",
                    [itemName, user.company_id]
                );

                if (itemExist.length > 0) {
                    const user = req.session.user;
                    const companyId = user.company_id;
                    const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
                    const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

                    if (!companyId) {
                        return res.render("admin/error.ejs", { error: 'No company found for this user.' });
                    }

                    const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);

                    const [items] = await mysql.query(`
                        SELECT items.*, categories.category AS categoryName 
                        FROM items 
                        LEFT JOIN categories ON items.category_id = categories.id
                        WHERE items.company_id = ?
                    `, [companyId]);
                    return res.render('admin/addItems.ejs', { items, error: 'Product with the same name or code already exists.', user, categories, companies, currentCompany });
                }

                const generateItemCode = () => {
                    const prefix = "ITEM";
                    const randomNumber = Math.floor(1000 + Math.random() * 9000);
                    const timestamp = Date.now().toString().slice(-4);
                    return `${prefix}-${randomNumber}-${timestamp}`;
                };

                const newItemCode = itemCode || generateItemCode();
                const user_id = req.session.user.id
                
                await mysql.query(
                    "INSERT INTO items (item_name, item_hsn, category_id, unit, image, sale_price, sale_price_tax_included, discount_value, discount_type, wholesale_price_1, wholesale_quantity_1,wholesale_price_2, wholesale_quantity_2,wholesale_price_3, wholesale_quantity_3,service_charge_quantity_1,service_charge_1,service_charge_quantity_2,service_charge_2,service_charge_quantity_3,service_charge_3, purchase_price, purchase_price_tax_included, tax_rate, item_code, company_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?,?,?,?,?,?)",
                    [
                        itemName,
                        itemHSN,
                        category || null,
                        unit,
                        image || null,
                        salePrice || 0,
                        salePriceTaxIncluded || false,
                        discountValue || 0,
                        discountType || null,
                        wholesalePrice1,
                        wholesaleQuantity1,
                        wholesalePrice2 ,
                        wholesaleQuantity2 ,
                        wholesalePrice3 ,
                        wholesaleQuantity3,
                        serviceChargeQuantity1,
                        serviceCharge1,
                        serviceChargeQuantity2,
                        serviceCharge2,
                        serviceChargeQuantity3,
                        serviceCharge3,
                        purchasePrice || 0,
                        purchasePriceTaxIncluded || false,
                        taxRate || 0,
                        newItemCode,
                        companyId,
                        user_id
                    ]
                );

                const [items] = await mysql.query(`
                    SELECT items.*, categories.category AS categoryName 
                    FROM items 
                    LEFT JOIN categories ON items.category_id = categories.id
                    WHERE items.company_id = ?
                `, [companyId]);

                // res.render('admin/itemManagement.ejs', { items, user, companies, currentCompany });
                res.redirect('/admin/viewItems')

            } catch (error) {
                console.error(error);
            }
        });
    },


    // Fetch items related to the company
    viewItems: async (req, res) => {
        const user = req.session.user;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        const companyId = user.company_id;

        if (!companyId) {
            return res.render("admin/error.ejs", { error: 'No company found for this user.' });
        }

        const [items] = await mysql.query(`
            SELECT items.*, categories.category AS categoryName 
            FROM items 
            LEFT JOIN categories ON items.category_id = categories.id
            WHERE items.company_id = ?
        `, [companyId]);
        res.render('admin/itemManagement.ejs', { items, user: req.session.user ,currentCompany,companies});
    },

    // Add new category, linking it to the user's company
    addCategory: async (req, res) => {


        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        if (!companyId) {
            return res.render("admin/error.ejs", { error: 'No company found for this user.' });
        }

        const { category } = req.body;

        try {
            const [categoryExist] = await mysql.query("SELECT * FROM categories WHERE category = ? AND company_id = ?", [category, companyId]);

            if (categoryExist.length > 0) {
                const [categories] = await mysql.query("SELECT * FROM categories");
                return res.render('admin/addItems.ejs', {
                    categoryError: 'Category Already Exists.',
                    categories
                });
            }

            await mysql.query("INSERT INTO categories (category, user_id, company_id) VALUES (?, ?, ?)", [category, user.id, companyId]);

            const [categories] = await mysql.query("SELECT * FROM categories");
            return res.render('admin/addItems.ejs', {
                categories,
                success: 'Category added successfully.',
                companies,
                currentCompany,
                user
            });
        } catch (error) {
            console.error('Error in addCategory:', error);

            const [categories] = await mysql.query("SELECT * FROM categories");
            return res.render('admin/addItems.ejs', {
                error: 'An error occurred. Please try again.',
                categories,
                companies,
                currentCompany
            });
        }
    },
    viewAddSale: async (req, res) => {

        const user = req.session.user
        const previousRoute = res.locals.previousRoute;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE PartyStatus = '1' AND company_id = ?`, [user.company_id]);
        const today = new Date().toISOString().split('T')[0];
        const companyId = user.company_id;
        const products = await mysql.query(
            "SELECT * FROM items WHERE company_id = ? AND item_hsn = true", [companyId]);
        res.render('admin/addTransactions.ejs', { date: today, products: products[0], currentCompany, companies, user, parties, previousRoute });
    },
    viewAddPurchase: async (req, res) => {

        const user = req.session.user
        const previousRoute = res.locals.previousRoute;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE PartyStatus = '1' AND company_id = ?`, [user.company_id]);
        const today = new Date().toISOString().split('T')[0];
        const companyId = user.company_id;
        const products = await mysql.query(
            "SELECT * FROM items WHERE company_id = ?", [ companyId]);

        res.render('admin/addPurchase.ejs', { date: today, products: products[0], currentCompany, companies, user, parties, previousRoute });
    },


    addTransaction: async (req, res) => {
        let { partyName, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, transactionType } = req.body;
        const products = req.body.products;
        const user = req.session.user;
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id=?`, [partyName]);

        if(Number(recieved) >= Number(totalAmount)){
            paymentType = 'Cash';
        }


        let payable = Number(party[0].payable);
        let receivable = Number(party[0].receivable);
        const balance = Number(balanceDue);
        
//  checking 
        let toReceive = Number(party[0].to_receive)

        if(transactionType == 'purchase'){
                toReceive-= balance
        }else{
            toReceive+=balance
        }

//

        
        if (transactionType === "purchase") {
            if (receivable > 0) {
                if (receivable >= balance) {
                    receivable -= balance;
                } else {
                    payable += balance - receivable;
                    receivable = 0;
                }
            } else {
                if(balance>0){
                    payable += balance;
                }else{
                    receivable -= balance
                }
                
            }
        } else { // Sale transaction
            if (payable > 0) {
                if (payable >= balance) {
                    payable -= balance;
                } else {
                    receivable += balance - payable;
                    payable = 0;
                }
            } else {
                if(balance>0){
                receivable += balance;
                }else{
                    payable -= balance
                }
            }
        }
        
        // Update the party's payable and receivable
        await mysql.query(
            `UPDATE parties SET payable = ?, receivable = ?, to_receive = ? WHERE id = ?`,
            [payable, receivable, toReceive, partyName]
        );
        
        const sales = await mysql.query("INSERT INTO sales (customer_name, user_id, company_id, date, invoice_number, payment_type, total_amount, received_amount, balance_due, created_at, transaction_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            partyName, user.id, user.company_id, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, created_at, transactionType
        ]);
        
        //saving to cashFLow table
        const openingCash = await getOpeningCash(created_at, user.company_id);
        const closingCash = await calculateClosingCash(openingCash, created_at, user.company_id);

        const money_type = transactionType === 'sale' ? 'money_in' : 'money_out';
        
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,tnx_id, company_id, opening_cash, closing_cash) VALUES (?,?,?,?,?,?,?,?,?)`,
            [party[0].PartyName, created_at, transactionType, recieved, money_type, sales[0].insertId, user.company_id, openingCash, closingCash])
        
        if (products) {
            if(transactionType == 'purchase'){
                for (const product of products) {
                    await mysql.query(
                      `UPDATE items SET purchase_price = ? WHERE id = ?`,
                      [product.pricePerUnit, product.productId]
                    );
                  }
                  
            }
            await mysql.query("INSERT INTO sale_products (sale_id, item_id, quantity, delivered_quantity, price, discount, tax_rate, total,company_id, product_name, unit, serial_number,free_quantity) VALUES ?", [products.map(product => [sales[0].insertId, product.productId, product.quantity, product.deliveredQuantity, product.pricePerUnit, product.discount, product.tax, product.productTotal, user.company_id, product.item, product.unit,product.serial_number||0,product.freeQuantity||0])]);
            
            if(transactionType == 'sale'){
            const [sale_products] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id = ?`,[sales[0].insertId])
            await mysql.query("INSERT INTO delivery_details(sale_id, sale_product_id,delivery_date,delivered_quantity,company_id,item_id,notes,serial_number) VALUES ?",[sale_products.map(product=>[ sales[0].insertId, product.id, date, product.delivered_quantity, user.company_id,product.item_id,'Delivered while creating sale',product.serial_number])])
            }

            //controlling stock
            if (transactionType === "purchase") {
                for (const product of products) {
                    await mysql.query(`UPDATE items SET stock = stock + ? WHERE id = ?`, [Number(product.quantity)+Number(product.freeQuantity), product.productId]);

                    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
                        [product.productId, 'add', product.quantity, product.productTotal, 'due to purchase', created_at, user.company_id])
                }
                await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand - ? WHERE id = ?`,[recieved,user.company_id]);
            } else {
                for (const product of products) {
                    await mysql.query(`UPDATE items SET stock = stock - ? WHERE id = ?`, [Number(product.quantity)+Number(product.freeQuantity || 0), product.productId]);

                    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
                        [product.productId, 'reduce', product.quantity, product.productTotal, 'due to sale', created_at, user.company_id])
                }
                await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand + ? WHERE id = ?`,[recieved,user.company_id]);
            }
        }
        if (transactionType === "purchase") {
            return res.redirect('/admin/purchases');
        }
        res.redirect('/admin/sales');

    },

    addCompany: async (req, res) => {
        const { name } = req.body;
        const user_id = req.session.user.id;

        // Check if the company already exists
        const companyExist = await mysql.query(`SELECT * FROM companies WHERE name = ?`, [name]);
        // const [currentUser] = await mysql.query(`SELECT * FROM users WHERE id = ?`,user.id)

        if (companyExist[0].length === 0) {
            // Insert the new company into the database
            await mysql.query(`INSERT INTO companies (user_id, name, created_at) VALUES (?, ?, ?)`,
                [user_id, name, new Date()]);

            res.redirect('/admin/dashboard');
        } else {
            // If company already exists, send a response or redirect with a message
            res.redirect('/admin/dashboard?error=Company already exists');
        }
    },

    switchCompany: async (req, res) => {
        const user = req.session.user
        const company_id = req.params.id
        req.session.user.company_id = company_id
        res.redirect('/admin/dashboard');
    },

    viewParty: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const [oauth_tokens] = await mysql.query('SELECT * FROM oauth_tokens WHERE user_id = ?',[user.id]) 
        const access_token = oauth_tokens[0]?.access_token
        
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [results] = await mysql.query(`
            SELECT 
                p.id AS party_id,
                p.PartyName AS party_name,
                p.Phone,
                p.Email,
                p.Address,
                p.profile_picture,
                p.payable,
                p.receivable,
                NULL AS transaction_id,
                NULL AS transaction_date,
                NULL AS transaction_amount,
                NULL AS transaction_balance_due,
                NULL AS transaction_type,
                pp.id AS payment_id,
                pp.date AS payment_date,
                pp.amount AS payment_amount,
                pp.payment_type AS payment_type
            FROM 
                parties p
            LEFT JOIN 
                party_payments pp ON p.id = pp.party_id
            WHERE 
                p.company_id = ?
        
            UNION ALL
        
            SELECT 
                p.id AS party_id,
                p.PartyName AS party_name,
                p.Phone,
                p.Email,
                p.Address,
                p.profile_picture,
                p.payable,
                p.receivable,
                t.id AS transaction_id,
                t.date AS transaction_date,
                t.total_amount AS transaction_amount,
                t.balance_due AS transaction_balance_due,
                t.transaction_type AS transaction_type,
                NULL AS payment_id,
                NULL AS payment_date,
                NULL AS payment_amount,
                NULL AS payment_type
            FROM 
                parties p
            LEFT JOIN 
                sales t ON p.id = t.customer_name
            WHERE 
                p.company_id = ?`, [user.company_id, user.company_id]);
        const partiesMap = {};

        // Process the results into the desired structure
        results.forEach(row => {
            // If the party doesn't exist in the map, initialize it
            if (!partiesMap[row.party_id]) {
                partiesMap[row.party_id] = {
                    id: row.party_id,
                    name: row.party_name,
                    phone: row.Phone,
                    email: row.Email,
                    address: row.Address,
                    profile_picture: row.profile_picture,
                    payable : row.payable,
                    receivable : row.receivable,
                    transactions: []
                };
            }

            // Add the transaction details to the corresponding party
            if (row?.transaction_id || row?.payment_id) {
                partiesMap[row.party_id].transactions.push({
                    id: row.transaction_id || row.payment_id,
                    date: row.transaction_date || row.payment_date,
                    amount: row.transaction_amount || row.payment_amount,
                    balance_due: row.transaction_balance_due || 0,
                    transaction_type: row.transaction_type || row.payment_type,
                });
            }
        });

        const parties = Object.values(partiesMap);
        
        res.render('admin/partyDisplay.ejs', { title: 'parties', currentCompany, companies, user, parties , access_token});
    },
    addParty: async (req, res) => {
        upload(req, res, async function (err) {
            if (err instanceof multer.MulterError) {
                return res.status(500).json(err);
            } else if (err) {
                return res.status(500).json(err);
            }

            try {
                const user = req.session.user;
                const { name, email, phone, address, openingBalance, balanceType } = req.body;

                const image = req.file ? req.file.filename : null;

                if(balanceType == 'toReceive'){
                    await mysql.query(
                        "INSERT INTO parties (user_id, PartyName, Email, Phone, Address, profile_picture, to_receive, opening_balance, company_id) VALUES (?,?,?,?,?,?,?,?,?)",
                        [user.id, name, email, phone, address, image, openingBalance, openingBalance, user.company_id]
                    );
                }else{
                    await mysql.query(
                        "INSERT INTO parties (user_id, PartyName, Email, Phone, Address, profile_picture, to_receive, opening_balance, company_id) VALUES (?,?,?,?,?,?,?,?,?)",
                        [user.id, name, email, phone, address, image, -openingBalance, -openingBalance, user.company_id]
                    );
                }

                res.redirect('/admin/viewParties');
            } catch (dbError) {
                res.status(500).json({ error: "Database operation failed", details: dbError });
            }
        });
    },
    togglePartyStatus:async (req,res)=>{
        const {id,status} = req.query
        
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[id])
        if(party[0]){
            await mysql.query(`UPDATE parties set PartyStatus = ? WHERE id = ?`,[status,id])
            return res.json({currentStatus:status})
        }
    },

    deleteParty:async(req,res)=>{
        const {partyId} = req.query
        const [isTrancations] = await mysql.query(`SELECT * FROM sales WHERE customer_name = ?`,[partyId])
        if(isTrancations.length){
            return res.json({success:false})    
        }
        await mysql.query(`DELETE FROM parties WHERE id = ?`,[partyId])
        res.json({success:true})
    },

    viewEditParty:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const {partyId} = req.query;
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[partyId]);
        res.render('admin/partyEdit',{party:party[0],currentCompany,companies,user})

    },
    editParty: async (req, res) => {
        upload(req, res, async function (err) {
            if (err instanceof multer.MulterError) {
                return res.status(500).json(err);
            } else if (err) {
                return res.status(500).json(err);
            }

            try {
                const user = req.session.user;
                const { name, email, phone, openingBalance, balanceType, address, partyId } = req.body;

                const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[partyId]);         
                const image = req.file ? req.file.filename : party[0].profile_picture;

                

                if(balanceType == 'toReceive'){

                await mysql.query(`UPDATE parties SET to_receive = to_receive -?, opening_balance = opening_balance - ? WHERE id=?`,[party[0].openingBalance,party[0].openingBalance,partyId])
                await mysql.query(
                    "UPDATE parties SET PartyName = ?, Email = ?, Phone = ?, Address = ?, profile_picture = ?, opening_balance = ?,to_receive = ? WHERE id = ?",
                    [name,email,phone,address,image,openingBalance,openingBalance,partyId]
                )
            }else{
                await mysql.query(`UPDATE parties SET to_receive = to_receive +?, opening_balance = opening_balance + ? WHERE id=?`,[party[0].openingBalance,party[0].openingBalance,partyId])
                await mysql.query(
                    "UPDATE parties SET PartyName = ?, Email = ?, Phone = ?, Address = ?, profile_picture = ?, opening_balance =?, to_receive=? WHERE id = ?",
                    [name,email,phone,address,image,-openingBalance,-openingBalance,partyId]
                )   
            }

                res.redirect('/admin/viewParties');
            } catch (dbError) {
                res.status(500).json({ error: "Database operation failed", details: dbError });
            }
        });
    },

    logout: (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    },
    viewReports: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [grossProfit] = await mysql.query(
            `SELECT 
                COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN total_amount ELSE 0 END), 0) AS total_sales,
                COALESCE(SUM(CASE WHEN transaction_type = 'purchase' THEN total_amount ELSE 0 END), 0) AS total_purchases
            FROM sales
            WHERE company_id = ?`,
            [companyId]
        );

        const totalSales = grossProfit[0]?.total_sales || 0;
        const totalPurchases = grossProfit[0]?.total_purchases || 0;
        
        const [openingStock] = await mysql.query(
            `SELECT COALESCE(SUM(stock * purchase_price), 0) AS opening_stock 
            FROM items 
            WHERE company_id = ? AND created_at < ?`,
            [companyId ,'2000-01-01']
        );
        const totalOpeningStock = openingStock[0]?.opening_stock || 0;

        const [closingStock] = await mysql.query(
            `SELECT COALESCE(SUM(stock * purchase_price), 0) AS closing_stock 
            FROM items 
            WHERE company_id = ? AND created_at <= ?`,
            [companyId ,'2099-12-31']
        );
        const totalClosingStock = closingStock[0]?.closing_stock || 0;

        // ===== Added party_payments logic =====
        const [partyPayments] = await mysql.query(
            `SELECT 
                 COALESCE(SUM(CASE WHEN payment_type = 'payment_out' THEN discount ELSE 0 END), 0) AS total_payment_out_discount,
                 COALESCE(SUM(CASE WHEN payment_type = 'payment_in' THEN discount ELSE 0 END), 0) AS total_payment_in_discount
             FROM party_payments
             WHERE company_id = ? AND date BETWEEN ? AND ?`,
            [companyId,'2000-01-01','2099-12-31']
        );
        const totalPaymentOutDiscount = partyPayments[0]?.total_payment_out_discount || 0;
        const totalPaymentInDiscount = partyPayments[0]?.total_payment_in_discount || 0;

        const grossProfitValue = 
                (Number(totalSales) - totalPurchases) +
                (Number(totalClosingStock) - Number(totalOpeningStock)) +
                (Number(totalPaymentOutDiscount) - Number(totalPaymentInDiscount));

        
        
        res.render('admin/reports.ejs', { total_profit:grossProfitValue,companies,currentCompany,user });
    },
    viewExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [expenses] = await mysql.query(`SELECT * FROM expenses WHERE company_id = ?`, [company_id])

        const [categories] = await mysql.query('SELECT * FROM expense_category');

        const formattedData = categories.map(category => {
            const filteredExpenses = expenses
                .filter(expense => expense.category_id === category.id)
                .map(expense => ({
                    id:expense.expense_id,
                    expense_number: expense.expense_number,
                    date: new Date(expense.date),
                    amount: expense.amount,
                }));
            return {
                id: category.id,
                category_name: category.category_name,
                expenses: filteredExpenses,
            };
        });
        
        res.render('admin/expenseDisplay.ejs', { categories: formattedData,currentCompany,companies,user })
    },
    viewIncome: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [incomes] = await mysql.query(`SELECT * FROM other_income WHERE company_id = ?`, [company_id])

        const [categories] = await mysql.query('SELECT * FROM income_category');

        const formattedData = categories.map(category => {
            const filteredExpenses = incomes
                .filter(income => income.category_id === category.id)
                .map(income => ({
                    id:income.id,
                    income_number: income.income_number,
                    date: new Date(income.date),
                    amount: income.amount,
                }));
            return {
                id: category.id,
                category_name: category.category_name,
                incomes: filteredExpenses,
            };
        });
        res.render('admin/otherIncomeDisplay.ejs', { categories: formattedData,companies,currentCompany,user })
    },

    viewItemProfitAndLoss: async (req, res) => {
        try {
            const user = req.session.user;
             let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
            const company_id = user.company_id;
            const [results] = await mysql.query(`
                SELECT 
                    i.id AS item_id,
                    i.item_name,
                    i.purchase_price,
                    i.stock,
                    COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0) AS total_sales,
                    COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0) AS total_purchases,
                    COALESCE( i.purchase_price * i.stock , 0) AS stock_value,
                    CASE 
                        WHEN COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0) >
                             COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0) 
                        THEN COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0) -
                             COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0)
                        ELSE 0 
                    END AS profit,
                    CASE 
                        WHEN COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0) >
                             COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0) 
                        THEN COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0) -
                             COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0)
                        ELSE 0 
                    END AS loss
                FROM 
                    items i
                LEFT JOIN 
                    sale_products sp ON i.id = sp.item_id
                LEFT JOIN 
                    sales s ON sp.sale_id = s.id
                WHERE 
                    i.company_id = ?
                GROUP BY 
                    i.id, i.item_name
                ORDER BY 
                    i.item_name;
            `, [company_id]);
            

            res.render('admin/itemProfitAndLoss.ejs', { results,companies,currentCompany,user, })
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal server error' });
        }

    },
    viewCashFlow: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;

        const {start,end} = req.query

        // Fetch companies and current company
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);

        // Fetch all cash flows sorted by date
        const [cashFlows] = await mysql.query(`SELECT * FROM cash_flows WHERE company_id = ? ORDER BY date ASC`, [companyId]);
        
        const [openingCash] = await mysql.query(
            `SELECT COALESCE(SUM(
                CASE 
                  WHEN money_type = 'money_in' THEN amount 
                  WHEN money_type = 'money_out' THEN -amount 
                  ELSE 0 
                END
              ), 0) AS opening_cash 
             FROM cash_flows
             WHERE company_id = ? AND date < ?`,
            [companyId, start || '2000-01-01']
          );
          const totalOpeningCash = openingCash[0]?.opening_cash || 0;
          

          const [closingCash] = await mysql.query(
            `SELECT COALESCE(SUM(
                CASE 
                  WHEN money_type = 'money_in' THEN amount 
                  WHEN money_type = 'money_out' THEN -amount 
                  ELSE 0 
                END
              ), 0) AS closing_cash 
             FROM cash_flows 
             WHERE company_id = ? AND date <= ?`,
            [companyId, end || '2099-12-31']
          );
          
          const totalClosingCash = closingCash[0]?.closing_cash || 0;          
  
          if(start && end){
            return res.json({totalClosingCash,totalOpeningCash})
          }
        // Calculate opening cash, closing cash, money_in, and money_out
        let openingCashForCalculation = 0;
        let closingCashForCalculation = 0;
        let moneyIn = 0;
        let moneyOut = 0;

        cashFlows.forEach((cashFlow) => {
            cashFlow.opening_cash = openingCashForCalculation;

            if (cashFlow.money_type === 'money_in') {
                moneyIn += Number(cashFlow.amount);
                openingCashForCalculation += Number(cashFlow.amount);
            } else if (cashFlow.money_type === 'money_out') {
                moneyOut += Number(cashFlow.amount);
                openingCashForCalculation -= Number(cashFlow.amount);
            }

            cashFlow.closing_cash = openingCashForCalculation;
            closingCashForCalculation = openingCashForCalculation; // Update closing cash after the last transaction
        });

        // Pass aggregate values and cashFlows to the frontend
        res.render('admin/cashFlows.ejs', { currentCompany, companies, user, cashFlows, closingCash, moneyIn, moneyOut,totalClosingCash,totalOpeningCash });
    },

    viewDayBook: async (req, res) => {

        const date = req.query.date
        let startOfDay = 0;
        let endOfDay = 0;
        const today = new Date().toISOString().slice(0, 10);
        if (date) {
            startOfDay = `${date}T00:00:00.000Z`;
            endOfDay = `${date}T23:59:59.999Z`;
        } else {
            startOfDay = `${today}T00:00:00.000Z`;
            endOfDay = `${today}T23:59:59.999Z`;
        }

        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        if (!companyId) {
            return res.render("admin/error.ejs", { error: 'No company found for this user.' });
        }

        const [item] = await mysql.query(`
            SELECT 
                sales.*, 
                parties.PartyName AS customer_name
                
            FROM 
                sales
            LEFT JOIN 
                parties ON sales.customer_name = parties.id
            WHERE 
                sales.created_at BETWEEN ? AND ? AND
                sales.company_id = ?
        `, [startOfDay, endOfDay, companyId]);

       
        const [items] = await mysql.query(`
            SELECT 
                c.id,
                c.date,
                c.amount AS total_amount,
                c.tnx_type AS transaction_type,
                c.money_type,
                c.company_id,
                c.name AS customer_name
            FROM 
              cash_flows c
            WHERE 
               date BETWEEN ? AND ? AND
                company_id = ?
        `, [startOfDay, endOfDay, companyId]);

        let total_money_in = 0
        let total_money_out = 0
        items.forEach(item => {
            if (item.transaction_type === 'sale' || item?.money_type === 'money_in') {
                total_money_in += Number(item.total_amount);
            } else if(item.transaction_type === 'purchase' || item?.money_type === 'money_out'){
                total_money_out += Number(item.total_amount);
            }
        });

        let day_book_total = total_money_in - Number(total_money_out)
        if (date) {
            const data = { items, total_money_in, total_money_out, day_book_total }
            return res.json(data)
        }

        res.render('admin/dayBook.ejs', { title: 'Day Book', currentCompany, companies, user, items, total_money_in, total_money_out, day_book_total });
    },
    viewAddExpense: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [categories] = await mysql.query('SELECT * FROM expense_category');
        res.render('admin/addExpense.ejs', { categories,companies,currentCompany,user });
    },
    viewAddIncome: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [categories] = await mysql.query('SELECT * FROM income_category');
        res.render('admin/addOtherIncome.ejs', { categories,currentCompany,companies,user });    
    },
    addExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const { category_id, date, amount } = req.body
        const [expense] = await mysql.query(`INSERT INTO expenses (category_id,date,amount,expense_by,company_id) VALUES(?,?,?,?,?)`, [category_id, date, amount, 'superAdmin', company_id])    
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id,other_tnx_id) VALUES (?,?,?,?,?,?,?)`,['Expense',date,'expense',amount,'money_out',company_id,expense.insertId])
        res.redirect('/admin/expense');
    },
    addIncome: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const { category_id, date, amount } = req.body
        const [income] = await mysql.query(`INSERT INTO other_income (category_id,date,amount,income_by,company_id) VALUES(?,?,?,?,?)`, [category_id, date, amount, user.role, company_id])
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id,other_tnx_id) VALUES (?,?,?,?,?,?,?)`,['Income',date,'income',amount,'money_in',company_id,income.insertId])
        res.redirect('/admin/otherIncome');    
    },

    addExpenseCategory: async (req, res) => {
        const { name } = req.body
        await mysql.query(`INSERT INTO expense_category (category_name) VALUES(?)`, [name])
        res.redirect('/admin/expense')
    },
    addIncomeCategory: async (req, res) => {
        const { name } = req.body
        await mysql.query(`INSERT INTO income_category (category_name) VALUES(?)`, [name])
        res.redirect('/admin/otherIncome')
    },

    viewStockReport: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [items] = await mysql.query(`
            SELECT 
                i.id, 
                i.item_name, 
                i.stock, 
                i.unit, 
                i.sale_price,
                i.purchase_price,
                COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity ELSE 0 END), 0) AS quantity_out,  -- Total quantity sold
                COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity ELSE 0 END), 0) AS quantity_in  -- Total quantity purchased
            FROM items i
            LEFT JOIN sale_products sp ON i.id = sp.item_id
            LEFT JOIN sales s ON sp.sale_id = s.id
            WHERE i.company_id = ?
            GROUP BY i.id
        `, [user.company_id]);
    
            
    res.render('admin/stockReport.ejs',{items,companies,currentCompany,user})
    },
    viewAdjustStock:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const {item_id} = req.query
        res.render('admin/adjustStock',{item_id,companies,currentCompany,user})
        
    },
    viewAdjustStockDetails:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const {item_id} = req.query
        const [stock_adjustments] = await mysql.query(`SELECT * FROM stock_adjustments WHERE item_id=?`,[item_id])
        const [item] = await mysql.query(`SELECT * FROM items WHERE id=?`,[item_id])
        res.render('admin/adjustStockDetails.ejs',{stock_adjustments,item:item[0],companies,currentCompany,user})
    },
    adjustStock:async(req,res)=>{
        const user = req.session.user
        const company_id = user.company_id
        const{adjustmentType,date,quantity,price,details,item_id} = req.body
        await mysql.query(`
            UPDATE items 
            SET stock = stock + ? ,
            purchase_price = ?
            WHERE id = ?
        `, [adjustmentType == 'add' ? quantity : -quantity, price,item_id]);
    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
        [item_id,adjustmentType,quantity,price,details?details:'',date,company_id])
    
        res.redirect('/admin/viewStockReport')  
    },

    viewEditItems:async(req,res)=>{
        const {item_id} = req.query
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);

        const [item] = await mysql.query(`SELECT * FROM items WHERE id=?`,[item_id])
        
        
        res.render('admin/itemEdit.ejs',{item:item[0],user,companies,currentCompany,categories,user})
        
    },

    editItems: async (req, res) => {
        upload(req, res, async function (err) {
            if (err instanceof multer.MulterError) {
                return res.status(500).json(err);
            } else if (err) {
                return res.status(500).json(err);
            }
            const user = req.session.user;
            const companyId = user.company_id;
            const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

            if (!companyId) {
                return res.render("admin/error.ejs", { error: 'No company found for this user.' });
            }

            const {
                itemName,
                itemHSN,
                category,
                unit,
                salePrice,
                salePriceTaxIncluded,
                discountValue,
                discountType,
                wholesalePrice,
                purchasePrice,
                purchasePriceTaxIncluded,
                taxRate,
                itemCode,
                item_id,
                wholesaleQuantity1,
                wholesalePrice1,
                wholesaleQuantity2,
                wholesalePrice2,
                wholesaleQuantity3,
                wholesalePrice3,
                serviceChargeQuantity1,
                serviceCharge1,
                serviceChargeQuantity2,
                serviceCharge2,
                serviceChargeQuantity3,
                serviceCharge3,
            } = req.body;

            const [currentItem] = await mysql.query(`SELECT * FROM items WHERE id=?`, [item_id]);


            const image = req.file ? req.file.filename : currentItem[0]?.image;

            try {
                const user_id = req.session.user.id

                await mysql.query(
                    `UPDATE items 
                     SET 
                        item_name = ?, 
                        item_hsn = ?, 
                        category_id = ?, 
                        unit = ?, 
                        image = ?, 
                        sale_price = ?, 
                        sale_price_tax_included = ?, 
                        discount_value = ?, 
                        discount_type = ?, 
                        wholesale_price_1 = ?, 
                        wholesale_price_2 = ?, 
                        wholesale_price_3 = ?, 
                        wholesale_quantity_1 = ?, 
                        wholesale_quantity_2 = ?, 
                        wholesale_quantity_3 = ?, 
                        service_charge_1 = ?,
                        service_charge_2 = ?,
                        service_charge_3 = ?,
                        service_charge_quantity_1 = ?,
                        service_charge_quantity_2 = ?,
                        service_charge_quantity_3 = ?,
                        purchase_price = ?, 
                        purchase_price_tax_included = ?, 
                        tax_rate = ?, 
                        item_code = ?, 
                        company_id = ?, 
                        user_id = ?
                     WHERE id = ?`,
                    [
                        itemName,
                        itemHSN || null,
                        category || null,
                        unit,
                        image || null,
                        salePrice || 0,
                        salePriceTaxIncluded || false,
                        discountValue || 0,
                        discountType || null,
                        wholesalePrice1,
                        wholesalePrice2,
                        wholesalePrice3,
                        wholesaleQuantity1,
                        wholesaleQuantity2,
                        wholesaleQuantity3,
                        serviceCharge1,
                        serviceCharge2,
                        serviceCharge3,
                        serviceChargeQuantity1,
                        serviceChargeQuantity2,
                        serviceChargeQuantity3,
                        purchasePrice,
                        purchasePriceTaxIncluded || false,
                        taxRate,
                        itemCode,
                        companyId,
                        user_id,
                        item_id
                    ]
                );

                const [items] = await mysql.query(`
                    SELECT items.*, categories.category AS categoryName 
                    FROM items 
                    LEFT JOIN categories ON items.category_id = categories.id
                    WHERE items.company_id = ?
                `, [companyId]);

                // res.render('admin/itemManagement.ejs', { items, user, companies, currentCompany });
                res.redirect('/admin/viewItems')

            } catch (error) {
                console.error(error);
            }
        });
    },

    viewCashInHand : async(req,res)=>{
        try {
            const user = req.session.user
             let companyData= []
            if(user.role == 'superAdmin'){
                [companyData] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companyData] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
            const companyId = user.company_id;
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
            const [totalCashInHand] = await mysql.query(`
                SELECT 
                    company_id, 
                    user_id, 
                    SUM(cash_flow) AS cash_in_hand
                FROM (
                    -- Cash flow from sales
                    SELECT 
                        company_id, 
                        user_id, 
                        CASE 
                            WHEN transaction_type = 'sale' THEN received_amount 
                            WHEN transaction_type = 'purchase' THEN -received_amount 
                            ELSE 0 
                        END AS cash_flow
                    FROM 
                        sales 
                    WHERE 
                        payment_type = 'Cash'
                    UNION ALL
                    -- Cash flow from expenses
                    SELECT 
                        company_id, 
                        NULL AS user_id, 
                        -amount AS cash_flow
                    FROM 
                        expenses
                ) AS combined_cash_flows
                WHERE company_id = ?
                GROUP BY company_id
            `, [companyId]);
            
            const [transactionDetails] = await mysql.query(`SELECT s.received_amount, s.transaction_type, s.date, p.PartyName FROM sales s LEFT JOIN parties p ON s.customer_name = p.id WHERE s.company_id = ?`,[companyId])
            const [expenses] = await mysql.query(`SELECT e.amount AS received_amount, c.category_name AS transaction_type, date FROM expenses e LEFT JOIN expense_category c ON e.category_id = c.id WHERE e.company_id = ?`, [companyId]);
            const [cashFlows] = await mysql.query(`SELECT c.id, c.amount AS received_amount, c.money_type,c.tnx_type AS transaction_type, c.date, c.name AS PartyName FROM cash_flows c WHERE tnx_type = 'Cash Adjusted' AND company_id = ?`,[user.company_id])
            const [party_payments] = await mysql.query(`SELECT p.amount AS received_amount, p.payment_type AS transaction_type,p.date,p.party_name AS PartyName FROM party_payments p WHERE p.company_id = ?`,[companyId])
        
            res.render('admin/cashInHand.ejs',{currentCompany,companies:companyData,user,transactionDetails:[...transactionDetails,...expenses,...cashFlows,...party_payments],totalCashInHand,user})
        } catch (error) {
            console.error(error);
            
        }
    },
    totalReceivable: async (req, res) => {
        const user = req.session.user;
         let companyData= []
            if(user.role == 'superAdmin'){
                [companyData] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companyData] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const companyId = user.company_id;
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    
        const [partyWiseReceivable] = await mysql.query(`
          SELECT * FROM parties p WHERE p.company_id = ?`, [companyId]);
    
        res.render('admin/totalReceivable.ejs', {
            companies: companyData,
            currentCompany: currentCompany,
            partyWiseReceivable ,
            user
        });
    },

    totalPayable: async (req, res) => {
        const user = req.session.user;
         let companyData= []
            if(user.role == 'superAdmin'){
                [companyData] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companyData] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const companyId = user.company_id;
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    
        const [partyWisePayable] = await mysql.query(`
            SELECT * FROM parties p WHERE p.company_id = ?`, [companyId]);
        res.render('admin/totalPayable.ejs', {
            companies: companyData,
            currentCompany: currentCompany,
            partyWisePayable ,
            user
        });
    },
    itemReturn:async(req,res)=>{
        const user = req.session.user
        const {quantity,item_id} = req.body
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [sale_product] = await mysql.query(`SELECT * FROM sale_products WHERE id = ?`,[item_id])
        const sale_id = sale_product[0].sale_id
        const [sale] = await mysql.query(`SELECT * FROM sales WHERE id = ?`,[sale_id])
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[sale[0].customer_name])
        let saleTotal = sale[0].total_amount
        let saleBalanceDue = sale[0].balance_due
        let saleReceivedAmount = sale[0].received_amount
        let productTotal = sale_product[0].total
        let newSaleProductQuanity = sale_product[0].quantity -quantity
        let salePrice = sale_product[0].price
        let newDeliveredQuantity = sale_product[0].delivered_quantity-quantity
        const newProductTotal = productTotal - salePrice*quantity
        const newSaleTotal = saleTotal - salePrice*quantity

        const totalDiff = salePrice*quantity


        await mysql.query(`UPDATE sale_products set quantity = ?, delivered_quantity = ? ,returned_quantity = ?,total = ? WHERE id = ?`,[newSaleProductQuanity,newDeliveredQuantity,quantity,newProductTotal,item_id])

        if(saleBalanceDue > totalDiff){
            saleBalanceDue = saleBalanceDue - totalDiff
            await mysql.query(`UPDATE sales set is_returned = true,total_amount =?,balance_due =? WHERE id = ?`,[newSaleTotal,saleBalanceDue,sale_id])
        }else{
            saleReceivedAmount = saleReceivedAmount -saleBalanceDue-totalDiff
            await mysql.query(`UPDATE sales set is_returned = true,total_amount =?,balance_due =?,received_amount =? WHERE id = ?`,[newSaleTotal,saleBalanceDue,saleReceivedAmount,sale_id])
        }

        const openingCash = await getOpeningCash(created_at, user.company_id);
        const closingCash = await calculateClosingCash(openingCash, created_at, user.company_id);

        const money_type = sale[0].transactionType === 'sale' ? 'money_out' : 'money_in';
        
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,tnx_id, company_id, opening_cash, closing_cash) VALUES (?,?,?,?,?,?,?,?,?)`,
            [party[0].PartyName, created_at, 'Product_Return', totalDiff, money_type, sale[0].id, user.company_id, openingCash, closingCash])


        await mysql.query(`UPDATE items set stock = stock + ? WHERE id = ?`,[quantity,sale_product[0].item_id])
        
        if(sale[0].transaction_type == 'purchase'){
            res.redirect('/admin/purchases')
        }else{
            res.redirect('/admin/sales')
        }
    },

    addContacts: async (req, res) => {
        const user = req.session.user;
        const contactData = req.body;
        const contacts = contactData.contacts;
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE company_id =?`, [user.company_id]);
    
        for (const item of contacts) {
            const name = item.name || 'No Name';
            const phone = item.tel || null;
            const email = item.email || null;
            const address = null;
            const image = null;
            
    
            const isDuplicate = parties.some(party => party.PartyName == name);
            if (isDuplicate) {
                return res.status(409).json({ data: `${name} already exists` }); 
            }
    
            await mysql.query(
                "INSERT INTO parties (user_id, PartyName, Email, Phone, Address, profile_picture, company_id) VALUES (?,?,?,?,?,?,?)",
                [user.id, name || 'unknown', email, phone, address, image, user.company_id]
            );
        }
        res.json({ data: 'Contacts imported successfully' });

        await mysql.query('DELETE FROM oauth_tokens WHERE user_id = ? ',[user.id])
    },


    viewAdjustCash:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        res.render('admin/adjustCash.ejs',{currentCompany,companies,user})
    },

    adjustCash:async(req,res)=>{
        const user = req.session.user
        const {adjustmentType,date,amount,description} = req.body
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        if(adjustmentType == 'add'){
        await mysql.query(`UPDATE companies set cash_in_hand = cash_in_hand + ? WHERE id = ?`,[amount,user.company_id])
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,description,money_type,company_id) VALUES(?,?,?,?,?,?,?)`,['Cash Added',date,'Cash Adjusted',amount,description,'money_in',user.company_id])
        }else{
            await mysql.query(`UPDATE companies set cash_in_hand = cash_in_hand - ? WHERE id = ?`,[amount,user.company_id])
            await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,description,money_type,company_id) VALUES(?,?,?,?,?,?,?)`,['Cash Reduced',date,'Cash Adjusted',amount,description,'money_out',user.company_id])
        }
        res.redirect('/admin/cashInHand')
    },
    viewAddPaymentIn:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const {partyId} = req.query
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[partyId])
        res.render('admin/paymentIn.ejs',{party:party[0],currentCompany,companies,user})
    },

    addPaymentIn: async (req, res) => {
        const user = req.session.user;
        const { partyName, partyId, date, phone, amount, desc, discount } = req.body;
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`, [partyId]);
        // Convert to Number explicitly
        let receivable = Number(party[0].receivable) || 0;
        let payable = Number(party[0].payable) || 0;
        let totalAmount = Number(amount)+Number(discount)

        //checking
        let to_receive = Number(party[0].to_receive)
        to_receive -= Number(totalAmount)

        //
    
        // Use explicit comparisons instead of truthy/falsy checks
        if (receivable > 0) {
            if (Number(totalAmount) <= receivable) {
                receivable -= Number(totalAmount)
            } else {
                let diff = Number(totalAmount) - receivable;
                receivable = 0;
                payable = payable + diff;
            }
        } else {
            payable = payable + Number(totalAmount)
        }
    
        const [data] = await mysql.query(
            `INSERT INTO party_payments (party_name, phone, date, description, amount, discount, payment_type, party_id, company_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
             [partyName, phone, date, desc, amount, discount, 'payment_in', partyId, user.company_id]
        );
        await mysql.query(`UPDATE parties SET receivable = ?, payable = ?, to_receive = ? WHERE id = ?`, [receivable, payable, to_receive, partyId]);
        await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand + ? WHERE id = ?`, [amount, user.company_id]);
        await mysql.query(
            `INSERT INTO cash_flows (name, date, tnx_type, amount, money_type, payment_id, company_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
             [partyName, created_at, 'Payment_In', amount, 'money_in', data.insertId, user.company_id]
        );
        res.redirect('/admin/viewParties');
    },
    
    viewAddPaymentOut:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const {partyId} = req.query
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[partyId])
        res.render('admin/paymentOut.ejs',{party:party[0],companies,currentCompany,user})
    },

    addPaymentOut: async (req, res) => {
        const user = req.session.user;
        const { partyName, partyId, date, phone, amount, desc, discount} = req.body;
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
        // Fetch the current party details
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`, [partyId]);
    
        // Ensure receivable and payable are numbers, defaulting to 0 if null
        let receivable = Number(party[0].receivable) || 0;
        let payable = Number(party[0].payable) || 0;
        let paymentAmount = Number(amount)+Number(discount);

        //checking
        let to_receive = Number(party[0].to_receive)
        to_receive += Number(paymentAmount)
        //
    
        if (payable > 0) {
            if (paymentAmount <= payable) {
                payable -= paymentAmount; // Directly deduct from payable
            } else {
                let diff = paymentAmount - payable;
                payable = 0; // Payable is fully cleared
                receivable += diff; // Excess payment increases receivable
            }
        } else {
            receivable += paymentAmount; // If no payable, entire amount increases receivable
        }
    
        // Insert into party_payments
        const [data] = await mysql.query(
            `INSERT INTO party_payments (party_name, phone, date, description, amount, discount, payment_type, party_id, company_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [partyName, phone, date, desc, amount, discount, 'payment_out', partyId, user.company_id]
        );
    
        // Update party's receivable and payable amounts
        await mysql.query(`UPDATE parties SET receivable = ?, payable = ?, to_receive = ? WHERE id = ?`, [receivable, payable, to_receive, partyId]);
    
        // Update company's cash-in-hand
        await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand - ? WHERE id = ?`, [amount, user.company_id]);
    
        // Insert into cash_flows
        await mysql.query(
            `INSERT INTO cash_flows (name, date, tnx_type, amount, money_type, payment_id, company_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [partyName, created_at, 'Payment_Out', amount, 'money_out', data.insertId, user.company_id]
        );
    
        res.redirect('/admin/viewParties');
    },
    
    
    viewexchangeRates:async(req,res)=>{
        const user = req.session.user
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [rates] = await mysql.query('SELECT * FROM exchange_rates');
        res.render('admin/exchangeRates.ejs', { rates,currentCompany,companies,user });
    },

    updateExchangeRates:async(req,res)=>{
        const { inrToSar, sarToInr } = req.body;

    await mysql.query(`
        INSERT INTO exchange_rates (currency_from, currency_to, exchange_rate) 
        VALUES ('INR', 'SAR', ?), ('SAR', 'INR', ?)
        ON DUPLICATE KEY UPDATE exchange_rate = VALUES(exchange_rate)`, 
        [inrToSar, sarToInr]
    );

    res.redirect('/admin/exchange-rates');
    },

    getExchangeRate: async (req, res) => {
        const [rates] = await mysql.query('SELECT * FROM exchange_rates');
        
        res.json(rates);
    },

    viewProfitAndLoss: async (req, res) => {
        try {
            const user = req.session.user;
            const companyId = user.company_id;
            let { start, end } = req.query;
            end = end ? end + ' 23:59:59' : null
            console.log(start,end);
            
             let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
            
            // Calculate Gross Profit (Sales - Purchases)
            const [grossProfit] = await mysql.query(
                `SELECT 
                    COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN total_amount ELSE 0 END), 0) AS total_sales,
                    COALESCE(SUM(CASE WHEN transaction_type = 'purchase' THEN total_amount ELSE 0 END), 0) AS total_purchases
                FROM sales
                WHERE company_id = ? AND date BETWEEN ? AND ?`,
                [companyId, start || '2000-01-01', end || '2099-12-31']
            );
            
            const totalSales = grossProfit[0]?.total_sales || 0;
            const totalPurchases = grossProfit[0]?.total_purchases || 0;
            
            const [otherIncome] = await mysql.query(
                `SELECT COALESCE(SUM(amount), 0) AS total_income FROM other_income WHERE company_id = ? AND date BETWEEN ? AND ?`,
                [companyId, start || '2000-01-01', end || '2099-12-31']
            );
            const totalOtherIncome = otherIncome[0]?.total_income || 0;
            
            const [otherExpenses] = await mysql.query(
                `SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ?`,
                [companyId, start || '2000-01-01', end || '2099-12-31']
            );
            const totalOtherExpenses = otherExpenses[0]?.total_expenses || 0;
            
            const [openingStock] = await mysql.query(
                `SELECT COALESCE(SUM(stock * purchase_price), 0) AS opening_stock 
                FROM items 
                WHERE company_id = ? AND created_at < ?`,
                [companyId, start || '2000-01-01']
            );
            const totalOpeningStock = openingStock[0]?.opening_stock || 0;
            
            const [closingStock] = await mysql.query(
                `SELECT COALESCE(SUM(stock * purchase_price), 0) AS closing_stock 
                FROM items 
                WHERE company_id = ? AND created_at <= ?`,
                [companyId, end || '2099-12-31']
            );
            const totalClosingStock = closingStock[0]?.closing_stock || 0;
            
            // ===== Added party_payments logic =====
            const [partyPayments] = await mysql.query(
                `SELECT 
                     COALESCE(SUM(CASE WHEN payment_type = 'payment_out' THEN discount ELSE 0 END), 0) AS total_payment_out_discount,
                     COALESCE(SUM(CASE WHEN payment_type = 'payment_in' THEN discount ELSE 0 END), 0) AS total_payment_in_discount
                 FROM party_payments
                 WHERE company_id = ? AND date BETWEEN ? AND ?`,
                [companyId, start || '2000-01-01', end || '2099-12-31']
            );
            const totalPaymentOutDiscount = partyPayments[0]?.total_payment_out_discount || 0;
            const totalPaymentInDiscount = partyPayments[0]?.total_payment_in_discount || 0;
            // ======================================
            
            // ===== Adjusted gross profit calculation to incorporate party_payments discount effect =====
            const grossProfitValue = 
                (Number(totalSales) - totalPurchases) +
                (Number(totalClosingStock) - Number(totalOpeningStock)) +
                (Number(totalPaymentOutDiscount) - Number(totalPaymentInDiscount));
            // ============================================================================================
            
            const netProfit = (Number(grossProfitValue) + Number(totalOtherIncome) - Number(totalOtherExpenses));
            

            if (start && end) {
                return res.json({
                    grossProfit: grossProfitValue,
                    netProfit,
                    totalSales,
                    totalPurchases,
                    totalOtherIncome,
                    totalOtherExpenses,
                    totalOpeningStock,
                    totalClosingStock
                });
            }

            

            res.render('admin/profitAndLoss.ejs', {
                currentCompany,
                companies,
                grossProfit: grossProfitValue,
                netProfit,
                totalSales,
                totalPurchases,
                totalOtherIncome,
                totalOtherExpenses,
                totalOpeningStock,
                totalClosingStock,
                start,
                end,
                user
            });
    
        } catch (error) {
            console.error("Error calculating profit and loss:", error);
            res.status(500).send("Internal Server Error");
        }
    },

    viewPartyTransactions:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
        const {partyId} = req.query

        const [results] = await mysql.query(`
            SELECT 
                p.id AS party_id,
                p.PartyName AS party_name,
                p.Phone,
                p.Email,
                p.Address,
                p.profile_picture,
                p.payable,
                p.receivable,
                p.to_receive,
                NULL AS transaction_id,
                NULL AS transaction_date,
                NULL AS transaction_amount,
                NULL AS transaction_balance_due,
                NULL AS transaction_type,
                pp.id AS payment_id,
                pp.date AS payment_date,
                pp.amount AS payment_amount,
                pp.payment_type AS payment_type
            FROM 
                parties p
            LEFT JOIN 
                party_payments pp ON p.id = pp.party_id
            WHERE 
                p.id = ?
        
            UNION ALL
        
            SELECT 
                p.id AS party_id,
                p.PartyName AS party_name,
                p.Phone,
                p.Email,
                p.Address,
                p.profile_picture,
                p.payable,
                p.receivable,
                p.to_receive,
                t.id AS transaction_id,
                t.date AS transaction_date,
                t.total_amount AS transaction_amount,
                t.balance_due AS transaction_balance_due,
                t.transaction_type AS transaction_type,
                NULL AS payment_id,
                NULL AS payment_date,
                NULL AS payment_amount,
                NULL AS payment_type
            FROM 
                parties p
            LEFT JOIN 
                sales t ON p.id = t.customer_name
            WHERE 
                p.id = ?`, [partyId,partyId]);

        const partiesMap = {};

        // Process the results into the desired structure
        results.forEach(row => {
            // If the party doesn't exist in the map, initialize it
            if (!partiesMap[row.party_id]) {
                partiesMap[row.party_id] = {
                    id: row.party_id,
                    name: row.party_name,
                    phone: row.Phone,
                    email: row.Email,
                    address: row.Address,
                    profile_picture: row.profile_picture,
                    payable : row.payable,
                    receivable : row.receivable,
                    to_receive : row.to_receive,
                    transactions: []
                };
            }

            // Add the transaction details to the corresponding party
            if (row?.transaction_id || row?.payment_id) {
                partiesMap[row.party_id].transactions.push({
                    id: row.transaction_id || row.payment_id,
                    date: row.transaction_date || row.payment_date,
                    amount: row.transaction_amount || row.payment_amount,
                    balance_due: row.transaction_balance_due || 0,
                    transaction_type: row.transaction_type || row.payment_type,
                });
            }
        });

        const parties = Object.values(partiesMap);

        res.render('admin/partyTransactions.ejs',{companies,currentCompany,parties,user})
    },

    viewTotalDelivered:async(req,res)=>{

        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);

        const [items] = await mysql.query(`
            SELECT
                i.item_name,
                i.id,
                SUM(sp.quantity - sp.delivered_quantity) AS total_delivery_pending
            FROM sale_products sp
            JOIN items i ON sp.item_id = i.id
            JOIN sales s ON sp.sale_id = s.id
            WHERE s.company_id = ?
            GROUP BY sp.item_id, i.item_name
            ORDER BY i.item_name
        `, [companyId]);
        
        
        
    
        // console.log(JSON.stringify(formattedData, null, 2));
        res.render('admin/totalDelivered.ejs',{companies,currentCompany,items,user})
        
    },

    viewDeliveryDetails:async(req,res)=>{   
        
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);

        const itemId = req.query.itemId
        const date = req.query.date
        console.log(date);
        

        try {
            // Fetch pending deliveries from sale_products where quantity > delivered_quantity
            let query = `
            SELECT 
                sp.item_id,
                sp.serial_number, 
                sp.company_id, 
                sp.product_name, 
                sp.sale_id, 
                sp.quantity AS total_quantity, 
                sp.delivered_quantity, 
                (sp.quantity - sp.delivered_quantity) AS remaining_quantity,
                s.customer_name AS party_id, 
                p.PartyName AS party_name
            FROM 
                sale_products sp
            JOIN 
                sales s ON sp.sale_id = s.id
            JOIN 
                parties p ON s.customer_name = p.id
            WHERE 
                sp.item_id = ?
                AND sp.quantity > sp.delivered_quantity
                AND s.transaction_type = 'sale'
                AND sp.company_id = ?
                AND s.company_id = ?
            `;

            const params = [itemId, companyId, companyId];

            if (date) {
            query += ` AND DATE(s.date) = ?`;
            params.push(date);
            }

            query += ` ORDER BY p.PartyName`;

            const [pendingSales] = await mysql.query(query, params);
            
            const [item] = await mysql.query(`SELECT item_name FROM items WHERE id = ?`, [itemId]);

            const [deliveries] = await mysql.query(`SELECT * FROM delivery_details WHERE item_id = ?`,[itemId])

            let total_quantity = 0
            pendingSales.forEach(item=>total_quantity+=Number(item.total_quantity))     
            
            if(date){
                return res.status(200).json({pendingSales,total_quantity})
            }
                
        res.render('admin/deliveryDetails.ejs', {
            item_name: item[0]?.item_name || "Unknown",
            pendingSales: pendingSales, companies,currentCompany,user,total_quantity,itemId
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
},

    viewDeliveryUpdates:async(req,res)=>{
        try {
            // Get the logged-in user from the session
            const user = req.session.user;
            const companyId = user.company_id;
             let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
            
            // Query to fetch delivery details for this company, ordered by delivery_date (newest first)
            const [deliveryDetails] = await mysql.query(`
                SELECT 
                  DATE_FORMAT(dd.delivery_date, '%d/%m/%Y') AS delivery_date,
                  dd.delivered_quantity,
                  dd.notes,
                  i.item_name,
                  dd.created_at,
                  dd.serial_number,
                  p.PartyName AS party_name,
                  dd.sale_id
                FROM delivery_details dd
                JOIN items i ON dd.item_id = i.id
                JOIN sales s ON dd.sale_id = s.id
                JOIN parties p ON s.customer_name = p.id
                WHERE dd.company_id = ?
                ORDER BY dd.created_at DESC
              `, [user.company_id]);
        
            // Render the deliveryDetails EJS view and pass the data
            res.render('admin/delivery_update', { deliveryDetails,companies,currentCompany,user });
          } catch (error) {
            console.error("Error fetching delivery details:", error);
            res.status(500).send("Internal Server Error");
          }
    },

    viewEditUser:async(req,res)=>{
        const user = req.session.user;
        const {userId} = req.query
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
        const [selectedUser] = await mysql.query(`SELECT * FROM users WHERE id = ?`,[userId])

        
        res.render('admin/userEdit.ejs',{companies,currentCompany,selectedUser:selectedUser[0],user})
    },

    editUser: async (req, res) => {
        try {
            const user = req.session.user;
            const companyId = user.company_id;
            const {data} = req.body;
                
            // Ensure selectedCompanies is a valid JSON array
            const companyJSON = Array.isArray(data.selectedCompanies)
                ? JSON.stringify(data.selectedCompanies)
                : '[]';
    
            // Fetch companies (inside try block for error handling)
             let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    
            const [currentUser] = await mysql.query(`SELECT * FROM users WHERE id =?`,[data.userId])

            if(currentUser[0].role !== 'superAdmin'){
                if (!data.password || data.password.trim() === '') {
                    await mysql.query(
                        `UPDATE users SET name = ?, email = ?, role = ?, available_companies = ? WHERE id = ?`,
                        [data.userName, data.userEmail, data.role, companyJSON, data.userId]
                    );
                } else {
                    const hashedPassword = await bcrypt.hash(data.password, 10);
                    await mysql.query(
                        `UPDATE users SET name = ?, email = ?, password = ?, role = ?, available_companies = ? WHERE id = ?`,
                        [data.userName, data.userEmail, hashedPassword, data.role, companyJSON, data.userId]
                    );
                }
        
                return res.json({ success: true });
        }else{
            if (!data.password || data.password.trim() === '') {
                await mysql.query(
                    `UPDATE users SET name = ?, email = ? WHERE id = ?`,
                    [data.userName, data.userEmail, data.userId]
                );
            } else {
                const hashedPassword = await bcrypt.hash(data.password, 10);
                await mysql.query(
                    `UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?`,
                    [data.userName, data.userEmail, hashedPassword, data.userId]
                );
            }
    
            return res.json({ success: true });
        }
    
        } catch (error) {
            console.error("Error updating user:", error);
            return res.status(500).json({ success: false, message: "Database error" });
        }
    },

    viewPaymentEdit:async(req,res)=>{

        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);

        const {paymentId} = req.query
        const [payment] = await mysql.query(`SELECT * FROM party_payments WHERE id = ?`,[paymentId])

        res.render('admin/paymentEdit.ejs',{companies,currentCompany,payment:payment[0],user})
        
    },

    paymentEdit: async (req, res) => {
        const user = req.session.user
        const { paymentId, amount, discount, desc, payment_type, partyId } = req.body;

        // Fetch current payment details
        const [current_payment] = await mysql.query('SELECT * FROM party_payments WHERE id = ?', [paymentId]);

        // Fetch current party details
        const [current_party] = await mysql.query('SELECT * FROM parties WHERE id = ?', [partyId]);

        let payable = Number(current_party[0].payable) || 0;
        let receivable = Number(current_party[0].receivable) || 0;

        let current_amount = Number(current_payment[0].amount);
        let updated_amount = Number(amount);

        let diff = updated_amount - current_amount; // Difference between new and old amount
        
        let to_receive = Number(current_party[0].to_receive)
        if(payment_type == 'payment_in'){
            to_receive += (Number(current_payment[0].amount)+Number(current_payment[0].discount))
            to_receive -= Number(amount)+Number(discount)
        }else{
            to_receive -= (Number(current_payment[0].amount)+Number(current_payment[0].discount))
            to_receive += Number(amount)+Number(discount)
        }

        let transaction_type = '';
        if (diff > 0) {
            transaction_type = 'money_increased';
        } else if (diff < 0) {
            transaction_type = 'money_decreased';
        } else {
            transaction_type = 'money_unchanged';
        }

        if (payment_type === 'payment_in') {
            // ===== Modified payment_in logic =====
            if (diff > 0) {
                // When the new payment is higher, reduce receivable if possible
                if (receivable >= diff) {
                    receivable -= diff;
                } else {
                    let remaining = diff - receivable;
                    receivable = 0;
                    payable += remaining;
                }
            } else if (diff < 0) {
                // When the new payment is lower (money decreased), add the difference to receivable
                receivable += Math.abs(diff);
            }
            // ======================================
        } else { 
            // Handling Payment Out (FIXED with money_increased & money_decreased)
            if (transaction_type === 'money_increased') {
                if (payable > 0) {
                    if (payable >= diff) {
                        payable -= diff;
                    } else {
                        receivable += diff - payable;
                        payable = 0;
                    }
                } else {
                    receivable += diff;
                }
            } else if (transaction_type === 'money_decreased') {
                if (receivable > 0) {
                    if (receivable >= Math.abs(diff)) {
                        receivable += diff;
                    } else {
                        payable += Math.abs(diff) - receivable;
                        receivable = 0;
                    }
                } else {
                    payable += Math.abs(diff);
                }
            }
        }

        // Update the payment details
        await mysql.query('UPDATE party_payments SET description = ?, amount = ?, discount = ? WHERE id = ?', [desc, amount, discount, paymentId]);

        await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand - ? WHERE id=?`,[current_payment[0].amount,user.company_id])
        await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand + ? WHERE id=?`,[amount,user.company_id])

        await mysql.query(`UPDATE cash_flows SET amount = ? WHERE payment_id = ?`, [amount, paymentId]);

        // Update the party balance
        await mysql.query('UPDATE parties SET receivable = ?, payable = ?, to_receive = ? WHERE id = ?', [receivable, payable, to_receive, partyId]);

        res.redirect('/admin/viewParties');

    },

    viewExpenseEdit:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);

        const expenseId = req.query.expenseId
        const [expense] = await mysql.query('SELECT * FROM expenses WHERE expense_id = ?',[expenseId])
        const [selectedCategory] = await mysql.query('SELECT * FROM expense_category WHERE id = ?',[expense[0].category_id])
        const [categories] = await mysql.query('SELECT * FROM expense_category')
        res.render('admin/expenseEdit',{companies,currentCompany,user,expense:expense[0],selectedCategory:selectedCategory[0],categories})
        
    },

    expenseEdit:async(req,res)=>{
        const user = req.session.user
        const {expense_id,category_id,amount,date}= req.body
        const [currentExpense] = await mysql.query(`SELECT * FROM expenses WHERE expense_id = ?`,[expense_id])
        await mysql.query(`UPDATE expenses SET category_id= ?, amount = ?, date=? WHERE expense_id = ?`,[category_id,amount,date,expense_id])
        // await mysql.query('UPDATE cash_flows SET amount = ?, date = ? WHERE other_tnx_id = ?',[amount,date,expense_id])
        let current_amount = Number(currentExpense[0].amount)
        let diff = Math.abs(Number(amount)-current_amount)
        if(Number(current_amount)<Number(amount)){
            await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id,other_tnx_id) VALUES (?,?,?,?,?,?,?)`,['Expense',date,'expense',diff,'money_out',user.company_id,expense_id])
        }else{
            await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id,other_tnx_id) VALUES (?,?,?,?,?,?,?)`,['Expense',date,'expense',diff,'money_in',user.company_id,expense_id])
        }
        res.redirect('/admin/expense')  
    },

    viewIncomeEdit:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);

        const incomeId = req.query.incomeId
        
        const [income] = await mysql.query('SELECT * FROM other_income WHERE id = ?',[incomeId])
        const [selectedCategory] = await mysql.query('SELECT * FROM income_category WHERE id = ?',[income[0].category_id])
        const [categories] = await mysql.query('SELECT * FROM income_category')

        res.render('admin/incomeEdit',{companies,currentCompany,user,income:income[0],selectedCategory:selectedCategory[0],categories})
        
    },

    incomeEdit:async(req,res)=>{
        const user = req.session.user
        const {income_id,category_id,amount,date}= req.body
        const [currentIncome] = await mysql.query(`SELECT * FROM other_income WHERE id = ?`,[income_id])
        await mysql.query(`UPDATE other_income SET category_id= ?, amount = ?, date=? WHERE id = ?`,[category_id,amount,date,income_id])
        // await mysql.query('UPDATE cash_flows SET amount = ?, date = ? WHERE other_tnx_id = ?',[amount,date,income_id])
        let current_amount = Number(currentIncome[0].amount)
        let diff = Math.abs(Number(amount)-current_amount)
        if(Number(current_amount)<Number(amount)){
            await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id,other_tnx_id) VALUES (?,?,?,?,?,?,?)`,['Income',date,'income',diff,'money_in',user.company_id,income_id])
        }else{
            await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id,other_tnx_id) VALUES (?,?,?,?,?,?,?)`,['Income',date,'income',diff,'money_out',user.company_id,income_id])
        }
        res.redirect('/admin/otherIncome')
    },

    storeAccessToken:async(req,res)=>{

        const user = req.session.user
        const body = req.body
        const access_token = body.access_token
    
        const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
        try {
            if(access_token){
        await mysql.query(`INSERT INTO oauth_tokens (user_id, access_token, expires_at)
                   VALUES (?, ?, ?)`,[user.id,access_token,expiresAt])
            }
        }catch (error) {
            console.error("Error storing access token:", error);
        }
    
    },


    viewItemDetail: async (req, res) => {
        const { item_name } = req.query;
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [allItems] = await mysql.query(`SELECT * FROM items WHERE  company_id = ?`, [companyId])


        try {
            const query = `
                    SELECT 
                        items.id AS item_id,
                        items.item_name,
                        COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.quantity ELSE 0 END), 0) AS sale_qty,
                        COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.quantity ELSE 0 END), 0) AS purchase_qty,
                        COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.free_quantity ELSE 0 END), 0) AS sale_free_qty,
                        COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.free_quantity ELSE 0 END), 0) AS purchase_free_qty,
                        (COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.quantity ELSE 0 END), 0) +
                        COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.free_quantity ELSE 0 END), 0) -
                        COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.quantity ELSE 0 END), 0) -
                        COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.free_quantity ELSE 0 END), 0)) AS closing_qty
                    FROM 
                        items
                    LEFT JOIN 
                        sale_products ON items.id = sale_products.item_id
                    LEFT JOIN 
                        sales ON sale_products.sale_id = sales.id
                    LEFT JOIN 
                        parties ON sales.customer_name = parties.id
                    WHERE 
                        items.company_id = ? 
                        ${item_name ? 'AND items.item_name = ?' : ''}  
                    GROUP BY 
                        items.id;
                `;

            
            const params = item_name ? [companyId, item_name] : [companyId];
            const [itemDetails] = await mysql.query(query, params);
            

            res.render('admin/itemDetailReport.ejs', { itemDetails, companies, user, currentCompany, allItems })

        } catch (error) {
            console.error("Error fetching item details:", error);
            res.status(500).json({ success: false, error: 'Failed to fetch item details.' });
        }
    },


    viewParties: async (req, res) => {
        const user = req.session.user;
         let companyData= []
            if(user.role == 'superAdmin'){
                [companyData] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companyData] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const companyId = user.company_id;
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
        const [oauth_tokens] = await mysql.query('SELECT * FROM oauth_tokens WHERE user_id = ?',[user.id]) 
        const access_token = oauth_tokens[0]?.access_token

        const [parties] = await mysql.query(`
            SELECT * FROM parties p WHERE p.company_id = ?`, [companyId]);
        res.render('admin/allParties.ejs', {
            companies: companyData,
            currentCompany: currentCompany,
            parties ,
            user,
            access_token
        });
    },

    importContacts :async (req, res) => {

    const fs = require('fs');
    const vCardParser = require('vcard-parser');
    const path = require('path');
    const user = req.session.user

        try {
            if (!req.file) {
                return res.status(400).json({ error: "No file uploaded" });
            }
    
            const filePath = req.file.path;    
    
            fs.readFile(filePath, 'utf8', async(err, data) => {
                if (err) {
                    console.error("Error reading file:", err);
                    return res.status(500).json({ error: "File read error" });
                }

                const contacts = data.split("BEGIN:VCARD").slice(1);

                    const parsedContacts = contacts.map(contact => {
                    let obj = {};
                    contact.split("\n").forEach(line => {
                    if (line.startsWith("FN:")) {
                        obj.fullName = line.replace("FN:", "").trim();
                    } else if (line.startsWith("TEL")) {
                        const type = line.includes("HOME") ? "home" : "mobile";
                        const number = line.split(":").pop().trim();
                        obj[type] = number;
                    }
                        });
                        return obj;
                    });

                for(const contact of parsedContacts){
                    const name = contact.fullName;
                    const phone = contact.mobile
                    await mysql.query(`INSERT INTO parties(PartyName,Phone,company_id) VALUES(?,?,?)`,[name?name:'Unknown',phone,user.company_id])
                }
                res.status(200).json({message:'Parties Added Successfully'})

            });
    
        } catch (error) {
            console.error("Error in importContacts:", error);
            res.status(500).json({ error: "Server error" });
        }
    },

    viewManageCompanies:async(req,res)=>{

        try {
            const user = req.session.user;
            const companyId = user.company_id;
             let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
    
            res.render('admin/manageCompanies.ejs',{companies,currentCompany,user})    
        } catch (error) {
            console.error(error);
        }
    },

    deleteCompany: async (req, res) => {
        const user = req.session.user;
        const companyId = req.query.companyId; // Get the company ID from the request
        try {
            // Check if the company exists
            const [selectedCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
            if (!selectedCompany) {
                return res.status(404).json({ success: false, message: "Company not found" });
            }

            if(selectedCompany[0].id == user.company_id){
                return res.status(400).json({ success: false, message: "Cannot Delete Selected Company! Try after switching." });
            }
    
            // Check if any related records exist in dependent tables
            const tablesToCheck = [
                "categories",
                "delivery_details",
                "expenses",
                "stock_adjustments",
                "items",
                "other_income",
                "party_payments",
                "sale_products",
                "sales",
                "parties"
            ];
    
            for (const table of tablesToCheck) {
                const [records] = await mysql.query(`SELECT COUNT(*) as count FROM ${table} WHERE company_id = ?`, [companyId]);
                if (records[0].count > 0) {
                    return res.status(400).json({
                        success: false,
                        message: "Company cannot be deleted. Try deleting transactions from the company and try again."
                    });
                }
            }
            
            // No related records found, proceed with deletion
            await mysql.query(`DELETE FROM companies WHERE id = ?`, [companyId]);
    
            return res.status(200).json({ success: true, message: "Company deleted successfully." });
    
        } catch (error) {
            console.error("Error deleting company:", error);
            return res.status(500).json({ success: false, message: "An error occurred while deleting the company." });
        }
    },

    viewCashInHandAdjustEdit:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
         let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        try {
            const cashFlowId = req.query.id
            const [cashFlow] = await mysql.query(`SELECT * FROM cash_flows WHERE id = ?`,[cashFlowId])
            res.render('admin/editAdjustCashInHand.ejs',{companies,currentCompany,user,cashFlow:cashFlow[0]})
        } catch (error) {
            console.error(error);
        }
    },

    cashInHandAdjustEdit:async(req,res)=>{
        try {
            const user = req.session.user;
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
            const {id,date,amount,description} = req.body

            const [currentCashFlow] = await mysql.query('SELECT * FROM cash_flows WHERE id=?',[id])
            // console.log("currentCashFlow",currentCashFlow);
            let current_amount = currentCashFlow[0].amount
            if(currentCashFlow[0].money_type == 'money_in'){
                await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand - ? WHERE id = ?`,[current_amount-amount,user.company_id])
                await mysql.query(`UPDATE cash_flows set date = ?,amount =?,description = ? WHERE id = ?`,[date,amount,description,id])
            }else{
                await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand + ? WHERE id = ?`,[current_amount-amount,user.company_id])
                await mysql.query(`UPDATE cash_flows set date = ?,amount =?,description = ? WHERE id = ?`,[date,amount,description,id])
            }
            
        res.redirect('/admin/cashInHand')            
            
        } catch (error) {
            console.error(error);
            
        }
    },

    viewItemReportByParty: async (req, res) => {
        const { partyId } = req.query; // Get partyId from query params (default: all parties)
        const user = req.session.user;
        const companyId = user.company_id;

        
    
        try {
            // Fetch company details
             let companies = []
            if(user.role == 'superAdmin'){
                [companies] = await mysql.query(`SELECT * FROM companies`);
            }else{
                [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            }
            
            // Fetch current company details
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
            
            // Fetch all parties for filtering dropdown
            const [allParties] = await mysql.query(`SELECT id, PartyName FROM parties WHERE company_id = ?`, [companyId]);
    
            // Query to fetch item details filtered by party
            const query = `
            SELECT 
                items.id AS item_id,
                items.item_name,
                COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.quantity ELSE 0 END), 0) AS sale_qty,
                COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.quantity ELSE 0 END), 0) AS purchase_qty,
                COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.free_quantity ELSE 0 END), 0) AS sale_free_qty,
                COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.free_quantity ELSE 0 END), 0) AS purchase_free_qty,
                (COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.quantity ELSE 0 END), 0) +
                 COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.free_quantity ELSE 0 END), 0) -
                 COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.quantity ELSE 0 END), 0) -
                 COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.free_quantity ELSE 0 END), 0)) AS closing_qty
            FROM 
                items
            LEFT JOIN 
                sale_products ON items.id = sale_products.item_id
            LEFT JOIN 
                sales ON sale_products.sale_id = sales.id
            LEFT JOIN 
                parties ON sales.customer_name = parties.id
            WHERE 
                items.company_id = ? 
                ${partyId ? 'AND parties.id = ?' : ''}  
            GROUP BY 
                items.id;
        `;
        
            
            const params = partyId ? [companyId, partyId] : [companyId];
            const [itemDetails] = await mysql.query(query, params);
            

            if(partyId){
                return res.json({success:true,itemDetails})
            }
    
            res.render('admin/itemReportByParty.ejs', { itemDetails, companies, user, currentCompany, allParties, selectedParty: partyId || 'All' });
        } catch (error) {
            console.error("Error fetching item report by party:", error);
            res.status(500).json({ success: false, error: 'Failed to fetch item reports.' });
        }
    },
    deleteItem:async(req,res)=>{
        try {
        const user = req.session.user
        const itemId = req.query.itemId
        const [isItemExists] = await mysql.query(`SELECT * FROM sale_products WHERE item_id = ?`,[itemId])
        if(isItemExists.length > 0){
            return res.json({success:false,message:'Cannot delete item as it is associated with some transactions'})
        }
        await mysql.query(`DELETE FROM stock_adjustments WHERE item_id = ?`,[itemId])
        await mysql.query(`DELETE FROM items WHERE id = ?`,[itemId])
        res.json({success:true,message:'Item Deleted Successfully'})
        } catch (error) {
            res.json({success:false,message:'Failed to delete item'})
        }
    },
    
    


}

module.exports = adminController;
