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
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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
        AND sales.transaction_type = 'sale'
`, [companyId]);





        res.render("businessOwner/sales.ejs", { title: "Sales", items, currentCompany, companies, user });
    },


    // Fetch dashboard data related to the logged-in user's company
    viewDashboard: async (req, res) => {
        try {
            const apiKey = process.env.EXCHANGE_RATE_API_KEY

            const user = req.session.user;
            const [companyData] = await mysql.query(`SELECT * FROM companies`);
            const companyId = user.company_id;
            const currentCompany = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

            if (!companyId) {
                return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
            }

            const [partyWisePayable] = await mysql.query(`
                SELECT 
                    p.id AS party_id,
                    p.PartyName AS party_name,
                    SUM(s.balance_due) AS total_payable
                FROM 
                    parties p
                LEFT JOIN 
                    sales s ON p.id = s.customer_name
                WHERE 
                    p.company_id = ?
                    AND s.transaction_type = 'purchase'
                GROUP BY 
                    p.id, p.PartyName
            `, [companyId]);
           
            const [partyWiseReceivable] = await mysql.query(`
                SELECT 
                    p.id AS party_id,
                    p.PartyName AS party_name,
                    SUM(s.balance_due) AS total_receivable
                FROM 
                    parties p
                LEFT JOIN 
                    sales s ON p.id = s.customer_name
                WHERE 
                    p.company_id = ?
                    AND s.transaction_type = 'sale'
                GROUP BY 
                    p.id, p.PartyName
            `, [companyId]);
           


            const totalPayable = partyWisePayable.reduce((acc, transaction) => {
                    return acc+Number(transaction.total_payable)
            }, 0);

            const totalReceivable = partyWiseReceivable.reduce((acc, transaction) => {
                return acc+Number(transaction.total_receivable)
            }, 0);

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

            const [items] = await mysql.query(`
                SELECT items.*, categories.category AS categoryName 
                FROM items 
                LEFT JOIN categories ON items.category_id = categories.id
                WHERE items.company_id = ? AND items.user_id = ?
            `, [companyId, user.id]);
    
            const stockValue = items.reduce((accumulator, item) => {
                return accumulator + Number(item.purchase_price) * Number(item.stock);
            }, 0);
            
            res.render('businessOwner/dashboard.ejs', { title: "Dashboard", totalReceivable, totalPayable, user, currentCompany: currentCompany[0], companies: companyData, apiKey, totalCashInHand: totalCashInHand[0], stockValue });
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            res.render('businessOwner/error.ejs', { error: 'An error occurred while fetching the dashboard data.' });
        }
    },

    viewAddItems: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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

    // Fetch items related to the company
    viewItems: async (req, res) => {
        const user = req.session.user;

        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE PartyStatus = '1' AND company_id = ?`, [user.company_id]);
        const today = new Date().toISOString().split('T')[0];
        const companyId = user.company_id;
        const products = await mysql.query(
            "SELECT * FROM items WHERE company_id = ? AND stock >0", [ companyId]);

        res.render('businessOwner/addTransactions.ejs', { date: today, products: products[0], currentCompany, companies, user, parties, previousRoute });
    },
    viewAddPurchase: async (req, res) => {

        const user = req.session.user
        const previousRoute = res.locals.previousRoute;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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
            await mysql.query("INSERT INTO sale_products (sale_id, item_id, quantity, price, discount, tax_rate, total,company_id, product_name, unit) VALUES ?", [products.map(product => [sales[0].insertId, product.productId, product.quantity, product.pricePerUnit, product.discount, product.tax, product.productTotal, user.company_id, product.item, product.unit])]);

            //controlling stock
            if (transactionType === "purchase") {
                for (const product of products) {
                    await mysql.query(`UPDATE items SET stock = stock + ? WHERE id = ?`, [product.quantity, product.productId]);

                    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
                        [product.productId, 'add', product.quantity, product.productTotal, 'due to purchase', created_at, user.company_id])
                }
            } else {
                for (const product of products) {
                    await mysql.query(`UPDATE items SET stock = stock - ? WHERE id = ?`, [product.quantity, product.productId]);

                    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
                        [product.productId, 'reduce', product.quantity, product.productTotal, 'due to sale', created_at, user.company_id])
                }
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

    viewParty: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [results] = await mysql.query(`
            SELECT 
                p.id AS party_id,
                p.PartyName AS party_name,
                p.Phone,
                p.Email,
                p.Address,
                p.profile_picture,
                t.id AS transaction_id,
                t.date AS transaction_date,
                t.total_amount AS transaction_amount,
                t.balance_due AS transaction_balance_due,
                t.transaction_type As transaction_type
            FROM 
                parties p
            LEFT JOIN 
                sales t ON p.id = t.customer_name
            WHERE 
                p.company_id = ? AND p.PartyStatus = 1` , [user.company_id]);

        // Initialize a map to group transactions by party ID
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
                    transactions: []
                };
            }

            // Add the transaction details to the corresponding party
            if (row.transaction_id) {
                partiesMap[row.party_id].transactions.push({
                    id: row.transaction_id,
                    date: row.transaction_date,
                    amount: row.transaction_amount,
                    balance_due: row.transaction_balance_due,
                    transaction_type: row.transaction_type,
                });
            }
        });

        const parties = Object.values(partiesMap);


        res.render('businessOwner/partyDisplay.ejs', { title: 'parties', currentCompany, companies, user, parties });
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
                const { name, email, phone, address } = req.body;

                const image = req.file ? req.file.filename : null;

                await mysql.query(
                    "INSERT INTO parties (user_id, PartyName, Email, Phone, Address, profile_picture) VALUES (?,?,?,?,?,?)",
                    [user.id, name, email, phone, address, image]
                );

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
                sales.created_at BETWEEN ? AND ? AND
                sales.company_id = ?
        `, [startOfDay, endOfDay, companyId]);
        console.log("items", items);
        console.log("date", date);

        let total_money_in = 0
        let total_money_out = 0
        items.forEach(item => {
            if (item.transaction_type === 'sale') {
                total_money_in += Number(item.total_amount);
            } else {
                total_money_out += Number(item.total_amount);
            }
        });

        let day_book_total = total_money_in - Number(total_money_out)
        if (date) {
            const data = { items, total_money_in, total_money_out, day_book_total }
            console.log("data", data);

            return res.json(data)
        }

        res.render('businessOwner/dayBook.ejs', { title: 'Day Book', currentCompany, companies, user, items, total_money_in, total_money_out, day_book_total });
    },

    viewCashFlow: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;

        // Fetch companies and current company
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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

            if (cashFlow.tnx_type === 'sale') {
                moneyIn += Number(cashFlow.amount);
                openingCash += Number(cashFlow.amount);
            } else if (cashFlow.tnx_type === 'purchase') {
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
        const [transactionProducts] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id = ?`, [transaction_id])

        res.render('businessOwner/transactionDetails', { user, currentCompany, companies, transactionDetails: transactionDetails[0], transactionProducts, previousRoute })
    },
    transactionDelete: async (req, res) => {

        const transaction_id = req.query.id
        await mysql.query(`DELETE FROM cash_flows WHERE tnx_id = ?`, [transaction_id]);
        await mysql.query(`DELETE FROM sale_products WHERE sale_id = ?`, [transaction_id]);
        await mysql.query(`DELETE FROM sales WHERE id = ?`, [transaction_id]);
        res.redirect('/business-owner/dashboard')

    },
    viewtransactionEdit: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const transaction_id = req.query.id
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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

        const [transactionDetails] = await mysql.query(`SELECT * FROM sales WHERE id = ?`, [transaction_id])

        if (transactionDetails[0].balanceDue !== balanceDue && transactionDetails[0].received_amount !== recieved) {
            const money_type = transactionType === 'sale' ? 'money_in' : 'money_out';
            await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,tnx_id, company_id) VALUES (?,?,?,?,?,?,?)`,
                [party[0].PartyName, created_at, transactionType, money_type, recieved, transaction_id, user.company_id]
            )
        }
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

        // for (let product of products) {
        //     await mysql.query(`
        //         UPDATE sale_products
        //         SET  
        //             item_id = ?, 
        //             quantity = ?, 
        //             price = ?, 
        //             discount = ?, 
        //             tax_rate = ?, 
        //             total = ?, 
        //             company_id = ?, 
        //             product_name = ?, 
        //             unit = ?
        //         WHERE id = ?`,
        //         [
        //             product.productId,
        //             product.quantity,
        //             product.pricePerUnit,
        //             product.discount,
        //             product.tax,
        //             product.productTotal,
        //             user.company_id,
        //             product.item,
        //             product.unit,
        //             product.productId
        //         ]
        //     );
        // }
        if (transactionType === "purchase") {
            return res.redirect('/business-owner/purchases');
        }
        res.redirect('/business-owner/sales');
    },

    viewItemDetail: async (req, res) => {
        const { itemId } = req.query;
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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
        const [companies] = await mysql.query(`SELECT * FROM companies`);
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

    viewAddExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [categories] = await mysql.query('SELECT * FROM expense_category');
        res.render('businessOwner/addExpense.ejs', { categories, companies, currentCompany, user });
    },
    addExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const { category_id, expense_number, date, amount } = req.body
        await mysql.query(`INSERT INTO expenses (category_id,expense_number,date,amount,company_id) VALUES(?,?,?,?,?)`, [category_id, expense_number, date, amount, company_id])
        res.redirect('/business-owner/dashboard');

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

    totalReceivable: async (req, res) => {
        const user = req.session.user;
        const [companyData] = await mysql.query(`SELECT * FROM companies`);
        const companyId = user.company_id;
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    
        const [partyWiseReceivable] = await mysql.query(`
            SELECT 
                p.id AS party_id,
                p.PartyName AS party_name,
                SUM(s.balance_due) AS total_receivable
            FROM 
                parties p
            LEFT JOIN 
                sales s ON p.id = s.customer_name
            WHERE 
                p.company_id = ?
                AND s.transaction_type = 'sale'
            GROUP BY 
                p.id, p.PartyName
        `, [companyId]);
    
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
            SELECT 
                p.id AS party_id,
                p.PartyName AS party_name,
                SUM(s.balance_due) AS total_receivable
            FROM 
                parties p
            LEFT JOIN 
                sales s ON p.id = s.customer_name
            WHERE 
                p.company_id = ?
                AND s.transaction_type = 'purchase'
            GROUP BY 
                p.id, p.PartyName
        `, [companyId]);
    
        res.render('businessOwner/totalPayable.ejs', {
            companies: companyData,
            currentCompany: currentCompany,
            partyWisePayable 
        });
    },
    viewCashInHand : async(req,res)=>{
        try {
            const user = req.session.user
            const [companyData] = await mysql.query(`SELECT * FROM companies`);
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
            
            const [transactionDetails] = await mysql.query(`SELECT s.received_amount, s.transaction_type, s.date, p.PartyName FROM sales s LEFT JOIN parties p ON s.customer_name = p.id WHERE s.payment_type = 'Cash' AND s.company_id = ?`,[companyId])
            const [expenses] = await mysql.query(`SELECT e.amount AS received_amount, c.category_name AS transaction_type, date FROM expenses e LEFT JOIN expense_category c ON e.category_id = c.id WHERE e.company_id = ?`, [companyId]);
            console.log(totalCashInHand);
            
            res.render('businessOwner/cashInHand.ejs',{currentCompany,companies:companyData,user,transactionDetails:[...transactionDetails,...expenses],totalCashInHand})
        } catch (error) {
            console.error(error);
            
        }
    }
    




}

module.exports = businessOwnerController;
