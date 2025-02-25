const mysql = require('../mySql');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path')

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


const businessOwnerController = {

    // Fetch sales for the logged-in user's company
    viewPurchases: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
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

        res.render("businessOwner/purchases.ejs", { title: "Sales", items, currentCompany, companies, user });
    },
    viewSales: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
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
        `, [companyId]);

        res.render("businessOwner/sales.ejs", { title: "Sales", items, currentCompany, companies, user });
    },


    // Fetch dashboard data related to the logged-in user's company
    viewDashboard: async (req, res) => {
        try {
            const apiKey = process.env.EXCHANGE_RATE_API_KEY

            const user = req.session.user;
            const [companyData] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
            const companyId = user.company_id;
            const currentCompany = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

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

            const totalCashInHand = currentCompany[0][0].cash_in_hand;

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

            res.render('businessOwner/dashboard.ejs', { title: "Dashboard", totalReceivable, totalPayable, user, currentCompany: currentCompany[0], companies: companyData, apiKey, totalCashInHand, stockValue , totalDelivered:totalDelivered[0]});
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            res.render('businessOwner/error.ejs', { error: 'An error occurred while fetching the dashboard data.' });
        }
    },

    viewAddItems: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);

        res.render('businessOwner/addItems.ejs', { categories: categories.length > 0 ? categories : [], companies, currentCompany, user, error: null });
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
            const [companies] = await mysql.query(`SELECT * FROM companies`);
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

            if (!companyId) {
                return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
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
                itemCode
            } = req.body;

            const image = req.file ? req.file.filename : null;

            try {

                const [itemExist] = await mysql.query(
                    "SELECT * FROM items WHERE item_name = ? AND user_id = ?",
                    [itemName, user.id]
                );

                if (itemExist.length > 0) {
                    const user = req.session.user;
                    const companyId = user.company_id;
                    const [companies] = await mysql.query(`SELECT * FROM companies`);
                    const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

                    if (!companyId) {
                        return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
                    }

                    const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);

                    const [items] = await mysql.query(`
                        SELECT items.*, categories.category AS categoryName 
                        FROM items 
                        LEFT JOIN categories ON items.category_id = categories.id
                        WHERE items.company_id = ?
                    `, [companyId]);
                    return res.render('businessOwner/addItems.ejs', { items, error: 'Product with the same name or code already exists.', user, categories, companies, currentCompany });
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
                    "INSERT INTO items (item_name, item_hsn, category_id, unit, image, sale_price, sale_price_tax_included, discount_value, discount_type, wholesale_price, purchase_price, purchase_price_tax_included, tax_rate, item_code, company_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        itemName,
                        itemHSN,
                        category,
                        unit,
                        image || null,
                        salePrice || 0,
                        salePriceTaxIncluded || false,
                        discountValue || 0,
                        discountType || null,
                        wholesalePrice || 0,
                        purchasePrice,
                        purchasePriceTaxIncluded || false,
                        taxRate,
                        newItemCode,
                        companyId, // Associating item with company
                        user_id
                    ]
                );

                const [items] = await mysql.query(`
                    SELECT items.*, categories.category AS categoryName 
                    FROM items 
                    LEFT JOIN categories ON items.category_id = categories.id
                    WHERE items.company_id = ?
                `, [companyId]);

                res.render('businessOwner/displayItem.ejs', { items, user, companies, currentCompany });

            } catch (error) {
                console.error(error);
                return res.render('businessOwner/addItems.ejs', { error: 'An error occurred. Please try again.' });
            }
        });
    },

    viewEditItems: async (req, res) => {
        const { item_id } = req.query
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);


        const [item] = await mysql.query(`SELECT * FROM items WHERE id=?`, [item_id])

        res.render('businessOwner/itemEdit.ejs', { item: item[0], user, companies, currentCompany, categories })

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
            const [companies] = await mysql.query(`SELECT * FROM companies`);
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

            if (!companyId) {
                return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
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
                item_id
            } = req.body;

            const [currentItem] = await mysql.query(`SELECT * FROM items WHERE id=?`, [item_id]);


            const image = req.file ? req.file.filename : currentItem[0].image;

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
                        wholesale_price = ?, 
                        purchase_price = ?, 
                        purchase_price_tax_included = ?, 
                        tax_rate = ?, 
                        item_code = ?, 
                        company_id = ?, 
                        user_id = ?
                     WHERE id = ?`,
                    [
                        itemName,
                        itemHSN,
                        category,
                        unit,
                        image || null,
                        salePrice || 0,
                        salePriceTaxIncluded || false,
                        discountValue || 0,
                        discountType || null,
                        wholesalePrice || 0,
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

                res.render('businessOwner/displayItem.ejs', { items, user, companies, currentCompany });

            } catch (error) {
                console.error(error);
                return res.render('businessOwner/editItem.ejs', { error: 'An error occurred. Please try again.' });
            }
        });
    },

    totalReceivable: async (req, res) => {
        const user = req.session.user;
        const [companyData] = await mysql.query(`SELECT * FROM companies`);
        const companyId = user.company_id;
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    
        const [partyWiseReceivable] = await mysql.query(`
          SELECT * FROM parties p WHERE p.company_id = ?`, [companyId]);
    
        res.render('businessOwner/totalReceivable.ejs', {
            companies: companyData,
            currentCompany: currentCompany,
            partyWiseReceivable 
        });
    },

    totalPayable: async (req, res) => {
        const user = req.session.user;
        const [companyData] = await mysql.query(`SELECT * FROM companies`);
        const companyId = user.company_id;
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    
        const [partyWisePayable] = await mysql.query(`
            SELECT * FROM parties p WHERE p.company_id = ?`, [companyId]);
    
        res.render('businessOwner/totalPayable.ejs', {
            companies: companyData,
            currentCompany: currentCompany,
            partyWisePayable 
        });
    },

    // Fetch items related to the company
    viewItems: async (req, res) => {
        const user = req.session.user;

        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const [items] = await mysql.query(`
            SELECT items.*, categories.category AS categoryName 
            FROM items 
            LEFT JOIN categories ON items.category_id = categories.id
            WHERE items.company_id = ? 
        `, [companyId]);

        const stockValue = items.reduce((accumulator, item) => {
            return accumulator + Number(item.purchase_price) * Number(item.stock);
        }, 0);

        res.render('businessOwner/displayItem.ejs', { items, user, currentCompany, companies, stockValue });
    },

    deleteItem: async (req, res) => {
        try {
            const { item_id } = req.query

            await mysql.query(`DELETE FROM items WHERE id = ?`, [item_id]);
        } catch (error) {
            console.error(error);
            // res.send('Item already in use, Cannot be deleted')
        }


    },

    // Add new category, linking it to the user's company
    addCategory: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const { category } = req.body;

        try {
            const [categoryExist] = await mysql.query("SELECT * FROM categories WHERE category = ? AND company_id = ?", [category, companyId]);

            if (categoryExist.length > 0) {
                const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
                return res.render('businessOwner/addItems.ejs', {
                    error: 'Category Already Exists.',
                    categories, companies, currentCompany, user
                });
            }

            await mysql.query("INSERT INTO categories (category, user_id, company_id) VALUES (?, ?, ?)", [category, user.id, companyId]);

            const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
            return res.render('businessOwner/addItems.ejs', {
                categories,
                success: 'Category added successfully.', companies, currentCompany, user, error: null
            });
        } catch (error) {
            console.error('Error in addCategory:', error);

            const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
            return res.render('businessOwner/addItems.ejs', {
                error: 'An error occurred. Please try again.',
                categories, companies, currentCompany, user
            });
        }
    },

    // View for adding sales
    viewAddSale: async (req, res) => {

        const user = req.session.user
        const previousRoute = res.locals.previousRoute;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE PartyStatus = '1' AND company_id = ?`, [user.company_id]);
        const today = new Date().toISOString().split('T')[0];
        const companyId = user.company_id;
        const products = await mysql.query(
            "SELECT * FROM items WHERE company_id = ? AND item_hsn = true", [companyId]);

        res.render('businessOwner/addTransactions.ejs', { date: today, products: products[0], currentCompany, companies, user, parties, previousRoute });
    },
    viewAddPurchase: async (req, res) => {

        const user = req.session.user
        const previousRoute = res.locals.previousRoute;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE PartyStatus = '1' AND company_id = ?`, [user.company_id]);
        const today = new Date().toISOString().split('T')[0];
        const companyId = user.company_id;
        const products = await mysql.query(
            "SELECT * FROM items WHERE company_id = ?", [ companyId]);

        res.render('businessOwner/addPurchase.ejs', { date: today, products: products[0], currentCompany, companies, user, parties, previousRoute });
    },

    addTransaction: async (req, res) => {
        const { partyName, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, transactionType } = req.body
        const products = req.body.products
        const user = req.session.user
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id=?`, [partyName])

        
        let payable = Number(party[0].payable);
        let receivable = Number(party[0].receivable);
        const balance = Number(balanceDue);
        
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
            `UPDATE parties SET payable = ?, receivable = ? WHERE id = ?`,
            [payable, receivable, partyName]
        );
        
        
        const sales = await mysql.query("INSERT INTO sales (customer_name, user_id, company_id, date, invoice_number, payment_type, total_amount, received_amount, balance_due, created_at, transaction_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            partyName, user.id, user.company_id, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, created_at, transactionType
        ]);

        //saving to cashFLow table
        const openingCash = await getOpeningCash(created_at, user.company_id);
        const closingCash = await calculateClosingCash(openingCash, created_at, user.company_id);
        console.log("openingCash", openingCash);
        console.log("closingCash", closingCash);

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

            await mysql.query("INSERT INTO sale_products (sale_id, item_id, quantity, delivered_quantity, price, discount, tax_rate, total,company_id, product_name, unit,free_quantity,serial_number) VALUES ?", [products.map(product => [sales[0].insertId, product.productId, product.quantity, product.deliveredQuantity, product.pricePerUnit, product.discount, product.tax, product.productTotal, user.company_id, product.item, product.unit,product.freeQuantity,product.serial_number||0])]);
            
            if(transactionType == 'sale'){
                const [sale_products] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id = ?`,[sales[0].insertId])
                await mysql.query("INSERT INTO delivery_details(sale_id, sale_product_id,delivery_date,delivered_quantity,company_id,item_id,notes,serial_number) VALUES ?",[sale_products.map(product=>[ sales[0].insertId, product.id, date, product.delivered_quantity, user.company_id,product.item_id,'Delivered while creating sale',product.serial_number])])
                }

            //controlling stock and cash in hand
            if (transactionType === "purchase") {
                for (const product of products) {
                    await mysql.query(`UPDATE items SET stock = stock + ? WHERE id = ?`, [Number(product.quantity)+Number(product.freeQuantity || 0), product.productId]);
                    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
                        [product.productId, 'add', product.quantity, product.productTotal, 'due to purchase', created_at, user.company_id])

                }
                await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand - ? WHERE id = ?`,[recieved,user.company_id]);
            } else {
                for (const product of products) {
                    console.log(product.freeQuantity);
                    
                    await mysql.query(`UPDATE items SET stock = stock - ? WHERE id = ?`, [Number(product.quantity)+Number(product.freeQuantity || 0), product.productId]);
                    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
                        [product.productId, 'reduce', product.quantity, product.productTotal, 'due to sale', created_at, user.company_id])
                }
                await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand + ? WHERE id = ?`,[recieved,user.company_id]);
            }
        }
        if (transactionType === "purchase") {
            return res.redirect('/business-owner/purchases');
        }
        res.redirect('/business-owner/sales');

    },

    addCompany: async (req, res) => {
        const { name } = req.body;
        const user_id = req.session.user.id;

        // Check if the company already exists
        const companyExist = await mysql.query(`SELECT * FROM companies WHERE name = ?`, [name]);

        if (companyExist[0].length === 0) {
            // Insert the new company into the database
            await mysql.query(`INSERT INTO companies (user_id, name, created_at) VALUES (?, ?, ?)`,
                [user_id, name, new Date()]);

            res.redirect('/business-owner/dashboard');
        } else {
            // If company already exists, send a response or redirect with a message
            res.redirect('/business-owner/dashboard?error=Company already exists');
        }
    },

    switchCompany: async (req, res) => {
        const user = req.session.user
        const company_id = req.params.id
        req.session.user.company_id = company_id
        res.redirect('/business-owner/dashboard');
    },

    togglePartyStatus:async (req,res)=>{
        const {id,status} = req.query
        
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[id])
        if(party[0]){
            await mysql.query(`UPDATE parties set PartyStatus = ? WHERE id = ?`,[status,id])
            return res.json({currentStatus:status})
        }else{

            return res.status(409).json({ currentStatus:'No Parties Selected' }); 
        }
    },

    viewParty: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
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

        res.render('businessOwner/partyDisplay.ejs', { title: 'parties', currentCompany, companies, user, parties });
    },

    viewCashInHand : async(req,res)=>{
        try {
            const user = req.session.user
            const [companyData] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
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
            const [cashFlows] = await mysql.query(`SELECT c.amount AS received_amount, c.money_type,c.tnx_type AS transaction_type, date, c.name AS PartyName FROM cash_flows c WHERE tnx_type = 'Cash Adjusted' AND company_id = ?`,[user.company_id])
            const [party_payments] = await mysql.query(`SELECT p.amount AS received_amount, p.payment_type AS transaction_type,p.date,p.party_name AS PartyName FROM party_payments p WHERE p.company_id = ?`,[companyId])
            
            res.render('businessOwner/cashInHand.ejs',{currentCompany,companies:companyData,user,transactionDetails:[...transactionDetails,...expenses,...cashFlows,...party_payments],totalCashInHand})
        } catch (error) {
            console.error(error);
            
        }
    },

    viewEditParty:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const {partyId} = req.query;
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[partyId]);
        res.render('businessOwner/partyEdit',{party:party[0],currentCompany,companies})

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
                const { name, email, phone, address,partyId } = req.body;

                const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[partyId]);                
                const image = req.file ? req.file.filename : party[0].profile_picture;
                await mysql.query(
                    "UPDATE parties set PartyName = ?, Email = ?, Phone = ?, Address = ?, profile_picture = ? WHERE id = ?",
                    [name,email,phone,address,image,partyId]
                )
                res.redirect('/business-owner/viewParty');
            } catch (dbError) {
                res.status(500).json({ error: "Database operation failed", details: dbError });
            }
        });
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


    logout: (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    },

    // viewRegister: (req, res) => {
    //     res.render('auth/register', { error: null })
    // },

    // handleRegister: async (req, res) => {
    //     const hashPassword = async (password) => {
    //         try {
    //             const saltRounds = 10; // Higher number = more secure but slower
    //             const hashedPassword = await bcrypt.hash(password, saltRounds);
    //             return hashedPassword;
    //         } catch (error) {
    //             console.error("Error hashing password:", error);
    //         }
    //     }
    //     const { name, email, password, phone } = req.body;
    //     const [emailExist] = await mysql.query("SELECT * FROM users WHERE email = ?", [email])

    //     if (!emailExist[0]) {
    //         hashPassword(password).then(async hashedPassword => {
    //             await mysql.query("INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)", [name, email, hashedPassword, 'businessOwner'])
    //             const [user] = await mysql.query("SELECT * FROM users WHERE email = ?", [email])


    //             await mysql.query(`INSERT INTO companies (user_id, name, created_at) VALUES (?, ?, ?)`,
    //                 [user[0].id, "Add a Company", new Date()]);
    //             res.redirect('/login')
    //         });
    //     } else {
    //         return res.send('Email already exists')
    //     }

    // },
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
                        "INSERT INTO parties (user_id, PartyName, Email, Phone, Address, profile_picture, receivable, company_id) VALUES (?,?,?,?,?,?,?,?)",
                        [user.id, name, email, phone, address, image, openingBalance, user.company_id]
                    );
                }else{
                    await mysql.query(
                        "INSERT INTO parties (user_id, PartyName, Email, Phone, Address, profile_picture, payable, company_id) VALUES (?,?,?,?,?,?,?,?)",
                        [user.id, name, email, phone, address, image, openingBalance, user.company_id]
                    );
                }
                
                
                res.redirect('/business-owner/viewParty');
            } catch (dbError) {
                res.status(500).json({ error: "Database operation failed", details: dbError });
            }
        });
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
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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

        res.render('businessOwner/dayBook.ejs', { title: 'Day Book', currentCompany, companies, user, items, total_money_in, total_money_out, day_book_total });
    },

    viewCashFlow: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;

        // Fetch companies and current company
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);

        // Fetch all cash flows sorted by date
        const [cashFlows] = await mysql.query(`SELECT * FROM cash_flows WHERE company_id = ? ORDER BY date ASC`, [companyId]);

        // Calculate opening cash, closing cash, money_in, and money_out
        let openingCash = 0;
        let closingCash = 0;
        let moneyIn = 0;
        let moneyOut = 0;

        cashFlows.forEach((cashFlow) => {
            cashFlow.opening_cash = openingCash;

            if (cashFlow.money_type === 'money_in') {
                moneyIn += Number(cashFlow.amount);
                openingCash += Number(cashFlow.amount);
            } else if (cashFlow.money_type === 'money_out') {
                moneyOut += Number(cashFlow.amount);
                openingCash -= Number(cashFlow.amount);
            }

            cashFlow.closing_cash = openingCash;
            closingCash = openingCash; // Update closing cash after the last transaction
        });

        // Pass aggregate values and cashFlows to the frontend
        res.render('businessOwner/cashFlow.ejs', { currentCompany, companies, user, cashFlows, closingCash, moneyIn, moneyOut });
    },



    transactionDetails: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const transaction_id = req.query.id
        const previousRoute = res.locals.previousRoute
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [transactionDetails] = await mysql.query(`SELECT * FROM sales WHERE id = ?`, [transaction_id])
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[transactionDetails[0].customer_name])
        const [transactionProducts] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id = ?`, [transaction_id])

        res.render('businessOwner/transactionDetails', { user, currentCompany, companies, transactionDetails: transactionDetails[0], transactionProducts, previousRoute, party:party[0] })
    },
    transactionDelete: async (req, res) => {

        const transaction_id = req.query.id
        await mysql.query(`DELETE FROM cash_flows WHERE tnx_id = ?`, [transaction_id]);
        await mysql.query(`DELETE FROM delivery_details WHERE sale_id = ?`,[transaction_id])
        await mysql.query(`DELETE FROM sale_products WHERE sale_id = ?`, [transaction_id]);
        await mysql.query(`DELETE FROM sales WHERE id = ?`, [transaction_id]);
        res.redirect('/business-owner/dashboard')

    },
    viewtransactionEdit: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const transaction_id = req.query.id
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [transactionDetails] = await mysql.query(`SELECT * FROM sales WHERE id = ?`, [transaction_id])
        const [transactionProducts] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id = ?`, [transaction_id])
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE company_id`, [user.company_id]);
        const products = await mysql.query("SELECT * FROM items WHERE company_id = ?", [companyId])
        const [current_party] = await mysql.query('SELECT * FROM parties WHERE id = ?', transactionDetails[0].customer_name)
        const previousRoute = res.locals.previousRoute

        res.render('businessOwner/transactionEdit.ejs', { user, currentCompany, companies, transactionDetails: transactionDetails[0], transactionProducts, parties, products: products[0], current_party: current_party[0], previousRoute })
    },
    transactionEdit: async (req, res) => {
        const { partyName, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, transactionType, transaction_id, } = req.body;
        const products = req.body.products;
        const user = req.session.user;
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id=?`, [partyName])
        const [currentProductsInTransactions] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id=?`,[transaction_id])
        const [transactionDetails] = await mysql.query(`SELECT * FROM sales WHERE id = ?`, [transaction_id])

        if(Number(transactionDetails[0].balance_due) != Number(balanceDue)){
            let payable = Number(party[0].payable);
            let receivable = Number(party[0].receivable);
            const balance = Math.abs(Number(balanceDue) - Number(transactionDetails[0].balance_due));

            if (transactionType === "purchase") {
                if (receivable > 0) {
                    if (receivable >= balance) {
                        receivable -= balance;
                    } else {
                        payable += balance - receivable;
                        receivable = 0;
                    }
                } else {
                    if(balance >= payable){
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
                `UPDATE parties SET payable = ?, receivable = ? WHERE id = ?`,
                [payable, receivable, partyName]
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

let current_received = transactionDetails[0].recieved

if (transactionType === "purchase") {
    await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand - ? WHERE id = ?`,[Number(recieved ||0) - Number(current_received||0),user.company_id]);
}else{
    await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand + ? WHERE id = ?`,[Number(recieved ||0) - Number(current_received||0),user.company_id]);
}
        
        if (transactionType === "purchase") {
            return res.redirect('/business-owner/purchases');
        }
        res.redirect('/business-owner/sales');
    },
    removeProductFromTrasaction:async(req,res)=>{
        const {id,quantity} = req.query
        console.log(id,quantity);
        const [sale_item] = await mysql.query(`SELECT * FROM sale_products WHERE id=?`,[id])
        const item_id = sale_item[0]?.item_id
        await mysql.query(`UPDATE items set stock = stock - ? WHERE id=?`,[quantity,item_id])
        if(id){
        await mysql.query(`DELETE FROM sale_products WHERE id = ?`, [id]);
        res.json({success:'Removed From Transaction History'})
        }
        
    },

    viewItemDetail: async (req, res) => {
        const { itemId } = req.query;
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [allItems] = await mysql.query(`SELECT * FROM items WHERE  company_id = ?`, [companyId])


        try {
            const [itemDetails] = await mysql.query(`
            SELECT 
                items.id AS item_id,
                items.item_name,
                items.item_hsn,
                items.category_id,
                -- Sales quantity: sum of quantities for transactions where transaction_type is 'sale'
                COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.quantity ELSE 0 END), 0) AS sale_qty,
                -- Purchase quantity: sum of quantities for transactions where transaction_type is 'purchase'
                COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.quantity ELSE 0 END), 0) AS purchase_qty,
                -- Adjustments quantity (if stock_adjustments table is available)
                COALESCE(SUM(stock_adjustments.adjustment_quantity), 0) AS adjust_qty,
                -- Closing quantity: purchase_qty + adjust_qty - sale_qty
                (COALESCE(SUM(CASE WHEN sales.transaction_type = 'purchase' THEN sale_products.quantity ELSE 0 END), 0) 
                + COALESCE(SUM(stock_adjustments.adjustment_quantity), 0) 
                - COALESCE(SUM(CASE WHEN sales.transaction_type = 'sale' THEN sale_products.quantity ELSE 0 END), 0)) AS closing_qty
            FROM 
                items
            LEFT JOIN 
                sale_products ON items.id = sale_products.item_id
            LEFT JOIN 
                sales ON sale_products.sale_id = sales.id
            LEFT JOIN 
                stock_adjustments ON items.id = stock_adjustments.item_id  -- Only if adjustments are tracked in a separate table
            WHERE 
                items.item_name = ? AND
                items.user_id = ? AND
                items.company_id = ?
            GROUP BY 
                items.id;
        `, [itemId, user.id, companyId]);


            res.render('businessOwner/itemDetailReport.ejs', { itemDetails, companies, user, currentCompany, allItems })

        } catch (error) {
            console.error("Error fetching item details:", error);
            res.status(500).json({ success: false, error: 'Failed to fetch item details.' });
        }
    },

    viewExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [expenses] = await mysql.query(`SELECT * FROM expenses WHERE company_id = ?`, [company_id])

        const [categories] = await mysql.query('SELECT * FROM expense_category');

        const formattedData = categories.map(category => {
            const filteredExpenses = expenses
                .filter(expense => expense.category_id === category.id)
                .map(expense => ({
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
        res.render('businessOwner/expenseDisplay.ejs', { categories: formattedData, user, companies, currentCompany })

    },
    viewIncome: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [incomes] = await mysql.query(`SELECT * FROM other_income WHERE company_id = ?`, [company_id])

        const [categories] = await mysql.query('SELECT * FROM income_category');

        const formattedData = categories.map(category => {
            const filteredExpenses = incomes
                .filter(income => income.category_id === category.id)
                .map(income => ({
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
        res.render('businessOwner/otherIncomeDisplay.ejs', { categories: formattedData,companies,currentCompany })
    },
    viewAddIncome: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        const [categories] = await mysql.query('SELECT * FROM income_category');
        res.render('businessOwner/addOtherIncome.ejs', { categories,currentCompany,companies });
    },
    addIncome: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const { category_id, date, amount } = req.body
        await mysql.query(`INSERT INTO other_income (category_id,income_number,date,amount,company_id) VALUES(?,?,?,?)`, [category_id, date, amount, company_id])
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id,other_tnx_id) VALUES (?,?,?,?,?,?,?)`,['Income',date,'income',amount,'money_in',company_id,income.insertId])
        res.redirect('/business-owner/otherIncome');
    },
    addIncomeCategory: async (req, res) => {
        const { name } = req.body
        await mysql.query(`INSERT INTO income_category (category_name) VALUES(?)`, [name])
        res.redirect('/business-owner/otherIncome')
    },

    viewAddExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [categories] = await mysql.query('SELECT * FROM expense_category');
        res.render('businessOwner/addExpense.ejs', { categories, companies, currentCompany, user });
    },
    addExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const { category_id, date, amount } = req.body
        await mysql.query(`INSERT INTO expenses (category_id,date,amount,company_id) VALUES(?,?,?,?)`, [category_id, date, amount, company_id])
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id,other_tnx_id) VALUES (?,?,?,?,?,?,?)`,['Expense',date,'expense',amount,'money_out',company_id,expense.insertId])
        res.redirect('/business-owner/expenses');
    },
    addExpenseCategory: async (req, res) => {
        const { name } = req.body
        await mysql.query(`INSERT INTO expense_category (category_name) VALUES(?)`, [name])
        res.redirect('/business-owner/expenses')
    },

    // downloadCashFlow: async (req, res) => {
    //     const user = req.session.user;
    //     const companyId = user.company_id;
    //     const [cashFlows] = await mysql.query(`SELECT * FROM cash_flows WHERE company_id = ?`, [companyId]);
    //     const [company] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

    //     const doc = new PDFDocument({ margin: 25 });
    //     // Specify the directory where the file will be saved
    //     const invoicesDir = path.join(__dirname, '..', 'invoices');

    //     if (!fs.existsSync(invoicesDir)) {
    //         fs.mkdirSync(invoicesDir);
    //     }


    //     // Create a write stream to save the PDF file
    //     const filePath = path.join(__dirname, '..', 'invoices', `Cash_Flow_Report_${Date.now()}.pdf`);
    //     doc.pipe(fs.createWriteStream(filePath));

    //     // Set up the title and header
    //     doc.fontSize(18).text('Cash Flow Report', { align: 'center' });
    //     doc.fontSize(12).text(`Company: ${company[0].name}`, { align: 'center' });
    //     doc.text(`City: Kerala, Country: India`, { align: 'center' });
    //     doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}\n\n`);

    //     // Table headers
    //     doc.fontSize(10).text('Transaction ID', 50, 150);
    //     doc.text('Name', 150, 150);
    //     doc.text('Transaction Type', 250, 150);
    //     doc.text('Amount (SAR)', 350, 150);
    //     doc.text('Money Type', 450, 150);
    //     doc.text('Date', 550, 150);

    //     // Add a line after headers
    //     doc.moveTo(50, 170).lineTo(580, 170).stroke();

    //     let yPosition = 180;

    //     // Iterate through cashFlows and add rows to the table
    //     cashFlows.forEach((item) => {
    //         doc.text(item.tnx_id, 50, yPosition);
    //         doc.text(item.name, 150, yPosition);
    //         doc.text(item.tnx_type, 250, yPosition);
    //         doc.text(item.amount, 350, yPosition);
    //         doc.text(item.money_type === 'money_out' ? 'Outgoing' : 'Incoming', 450, yPosition);
    //         doc.text(new Date(item.date).toLocaleDateString('en-GB'), 550, yPosition);

    //         yPosition += 20;
    //     });

    //     // Finalize the PDF and close the stream
    //     doc.end();
    //     console.log(filePath);

    //     // Send the file as a response
    //     res.download(filePath, `Cash_Flow_Report_${Date.now()}.pdf`);
    // }


    addContacts: async (req, res) => {
        const user = req.session.user;
        const contactData = req.body;
        const contacts = contactData.contacts;
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE company_id =?`, [user.company_id]);
    
        for (const item of contacts) {
            const name = item.name[0];
            const phone = item.tel[0]?.replace(/\D/g, '') || 'No Number found';
            const email = item?.email[0] || null;
            const address = item?.address[0] || null;
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
            res.redirect('/business-owner/purchases')
        }else{
            res.redirect('/business-owner/sales')
        }
    },

    
    viewAdjustCash:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        res.render('businessOwner/adjustCash.ejs',{currentCompany,companies})
    },

    adjustCash:async(req,res)=>{
        const user = req.session.user
        const {adjustmentType,date,amount,description} = req.body
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        if(adjustmentType == 'add'){
        await mysql.query(`UPDATE companies set cash_in_hand = cash_in_hand + ? WHERE id = ?`,[amount,user.company_id])
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id) VALUES(?,?,?,?,?,?)`,['Cash Added',created_at,'Cash Adjusted',amount,'money_in',user.company_id])
        }else{
            await mysql.query(`UPDATE companies set cash_in_hand = cash_in_hand - ? WHERE id = ?`,[amount,user.company_id])
            await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,company_id) VALUES(?,?,?,?,?,?)`,['Cash Reduced',created_at,'Cash Adjusted',amount,'money_out',user.company_id])
        }
        res.redirect('/business-owner/cashInHand')
    },
    viewAddPaymentIn:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const {partyId} = req.query
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[partyId])
        res.render('businessOwner/paymentIn.ejs',{party:party[0],currentCompany,companies})
    },

    addPaymentIn: async (req, res) => {
        const user = req.session.user;
        const { partyName, partyId, date, phone, amount, desc } = req.body;
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`, [partyId]);
        // Convert to Number explicitly
        let receivable = Number(party[0].receivable) || 0;
        let payable = Number(party[0].payable) || 0;
    
        // Use explicit comparisons instead of truthy/falsy checks
        if (receivable > 0) {
            if (Number(amount) <= receivable) {
                receivable -= Number(amount)
            } else {
                let diff = Number(amount) - receivable;
                receivable = 0;
                payable = payable + diff;
            }
        } else {
            payable = payable + Number(amount)
        }
    
        await mysql.query(
            `INSERT INTO party_payments (party_name, phone, date, description, amount, payment_type, party_id, company_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
             [partyName, phone, date, desc, amount, 'payment_in', partyId, user.company_id]
        );
        await mysql.query(`UPDATE parties SET receivable = ?, payable = ? WHERE id = ?`, [receivable, payable, partyId]);
        await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand + ? WHERE id = ?`, [amount, user.company_id]);
        await mysql.query(
            `INSERT INTO cash_flows (name, date, tnx_type, amount, money_type, company_id) 
             VALUES (?, ?, ?, ?, ?, ?)`,
             [partyName, created_at, 'Payment_In', amount, 'money_in', user.company_id]
        );
        res.redirect('/business-owner/viewParty');
    },

    viewAddPaymentOut:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const {partyId} = req.query
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`,[partyId])
        res.render('businessOwner/paymentOut.ejs',{party:party[0],companies,currentCompany})
    },

    addPaymentOut: async (req, res) => {
        const user = req.session.user;
        const { partyName, partyId, date, phone, amount, desc } = req.body;
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
        // Fetch the current party details
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id = ?`, [partyId]);
    
        // Ensure receivable and payable are numbers, defaulting to 0 if null
        let receivable = Number(party[0].receivable) || 0;
        let payable = Number(party[0].payable) || 0;
        let paymentAmount = Number(amount);
    
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
        await mysql.query(
            `INSERT INTO party_payments (party_name, phone, date, description, amount, payment_type, party_id, company_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [partyName, phone, date, desc, amount, 'payment_out', partyId, user.company_id]
        );
    
        // Update party's receivable and payable amounts
        await mysql.query(`UPDATE parties SET receivable = ?, payable = ? WHERE id = ?`, [receivable, payable, partyId]);
    
        // Update company's cash-in-hand
        await mysql.query(`UPDATE companies SET cash_in_hand = cash_in_hand - ? WHERE id = ?`, [amount, user.company_id]);
    
        // Insert into cash_flows
        await mysql.query(
            `INSERT INTO cash_flows (name, date, tnx_type, amount, money_type, company_id) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [partyName, created_at, 'Payment_Out', amount, 'money_out', user.company_id]
        );
    
        res.redirect('/business-owner/viewParty');
    },
    
    viewCalculator:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        res.render('businessOwner/calculator.ejs',{companies,currentCompany})
    },

    viewPartyTransactions:async(req,res)=>{
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
        const {partyId} = req.query
        console.log(partyId);
        

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

        res.render('businessOwner/partyTransactions.ejs',{companies,currentCompany,parties})
    },

    viewTotalDelivered:async(req,res)=>{

        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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
        res.render('businessOwner/totalDelivered.ejs',{companies,currentCompany,items})
        
    },

    viewDeliveryDetails:async(req,res)=>{   
        
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);

        const itemId = req.query.itemId
        console.log(itemId);    

        try {
            // Fetch pending deliveries from sale_products where quantity > delivered_quantity
            const [pendingSales] = await mysql.query(`
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
                    sp.item_id = ?  -- Filter by specific item
                    AND sp.quantity > sp.delivered_quantity
                    AND s.transaction_type = 'sale'
                    AND sp.company_id = ?
                    AND s.company_id = ?
                ORDER BY 
                    p.PartyName
            `, [itemId, companyId, companyId]);
            
            // Fetch party name
            const [item] = await mysql.query(`SELECT item_name FROM items WHERE id = ?`, [itemId]);

        res.render('businessOwner/deliveryDetails.ejs', {
            item_name: item[0]?.item_name || "Unknown",
            pendingSales: pendingSales, companies,currentCompany
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
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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
        res.render('businessOwner/delivery_update.ejs', { deliveryDetails,companies,currentCompany });
      } catch (error) {
        console.error("Error fetching delivery details:", error);
        res.status(500).send("Internal Server Error");
      }
},

viewPaymentEdit:async(req,res)=>{

    const user = req.session.user;
    const companyId = user.company_id;
    const [companies] = await mysql.query(`SELECT * FROM companies`);
    const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);

    const {paymentId} = req.query
    const [payment] = await mysql.query(`SELECT * FROM party_payments WHERE id = ?`,[paymentId])

    res.render('admin/paymentEdit.ejs',{companies,currentCompany,payment:payment[0],user})
    
},

paymentEdit: async (req, res) => {
    const { paymentId, amount, desc, payment_type, partyId } = req.body;

    const [current_payment] = await mysql.query('SELECT * FROM party_payments WHERE id = ?', [paymentId]);

    const [current_party] = await mysql.query('SELECT * FROM parties WHERE id = ?', [partyId]);

    let payable = Number(current_party[0].payable) || 0;
    let receivable = Number(current_party[0].receivable) || 0;

    let current_amount = Number(current_payment[0].amount);
    let updated_amount = Number(amount);

    let diff = updated_amount - current_amount; 

    let transaction_type = '';
    if (diff > 0) {
        transaction_type = 'money_increased';
    } else if (diff < 0) {
        transaction_type = 'money_decreased';
    } else {
        transaction_type = 'money_unchanged';
    }

    if (payment_type === 'payment_in') {
        // Handling Payment In
        if (receivable > 0) { 
            if (receivable >= Math.abs(diff)) { 
                receivable -= diff;
            } else {
                payable += Math.abs(diff) - receivable;
                receivable = 0;
            }
        } else {
            payable += diff;
        }
        console.log('if - payment_in');
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
        console.log('else - payment_out');
    }

    // Update the payment details
    await mysql.query('UPDATE party_payments SET description = ?, amount = ? WHERE id = ?', [desc, amount, paymentId]);

    // Update the party balance
    await mysql.query('UPDATE parties SET receivable = ?, payable = ? WHERE id = ?', [receivable, payable, partyId]);

    res.redirect('/admin/viewParty');
},

viewParties: async (req, res) => {
    const user = req.session.user;
    const [companies] = await mysql.execute(`SELECT * FROM companies WHERE JSON_CONTAINS((SELECT available_companies FROM users WHERE id = ?), JSON_QUOTE(CAST(id AS CHAR)));`,[user.id]);
    const companyId = user.company_id;
    const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    const [oauth_tokens] = await mysql.query('SELECT * FROM oauth_tokens WHERE user_id = ?',[user.id]) 
    const access_token = oauth_tokens[0]?.access_token

    const [parties] = await mysql.query(`
        SELECT * FROM parties p WHERE p.company_id = ?`, [companyId]);
    res.render('businessOwner/allParties.ejs', {
        companies,
        currentCompany: currentCompany,
        parties ,
        user,
        access_token
    });
},

// storeAccessToken:async(req,res)=>{

//     const user = req.session.user
//     const body = req.body
//     const access_token = body.access_token

//     const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
//     try {
//         if(access_token){
//     await mysql.query(`INSERT INTO oauth_tokens (user_id, access_token, expires_at)
//                VALUES (?, ?, ?)`,[user.id,access_token,expiresAt])
//         }
//     }catch (error) {
//         console.error("Error storing access token:", error);
//     }

// },


    
}

module.exports = businessOwnerController;
