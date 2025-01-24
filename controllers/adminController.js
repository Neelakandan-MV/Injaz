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




const adminController = {

    viewDashboard: async (req, res) => {
        const user = req.session.user;
        const apiKey = process.env.EXCHANGE_RATE_API_KEY

        try {
            const [companies] = await mysql.query(`SELECT * FROM companies`);
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

            // const [total_cash_inflow] = await mysql.query(`
            //     SELECT SUM(amount) AS total_cash_inflow 
            //     FROM cash_flows 
            //     WHERE money_type = 'money_in' AND company_id = ?;
            // `, [user.company_id]);

            // const [total_cash_outflow] = await mysql.query(`
            //     SELECT SUM(amount) AS total_cash_outflow 
            //     FROM cash_flows 
            //     WHERE money_type = 'money_out' AND company_id = ?;
            // `, [user.company_id]);

            // const [total_expenses] = await mysql.query(`
            //     SELECT SUM(amount) AS total_expenses 
            //     FROM expenses 
            //     WHERE company_id = ?;
            // `, [user.company_id]);

            // const [total_profit] = await mysql.query(`
            //     SELECT 
            //         (SELECT SUM(amount) FROM cash_flows WHERE money_type = 'money_in' AND company_id = ?) - 
            //         (SELECT SUM(amount) FROM cash_flows WHERE money_type = 'money_out' AND company_id = ?) - 
            //         (SELECT SUM(amount) FROM expenses WHERE company_id = ?) AS total_profit;
            // `, [user.company_id, user.company_id, user.company_id])


            const companyId = user.company_id;

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

            

            res.render('admin/dashboard.ejs', {
                title: "Admin Dashboard",
                totalCashInHand,
                totalPayable,
                totalReceivable,
                stockValue,
                currentCompany,
                companies,
                apiKey
            });
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            res.render('admin/error.ejs', { error: 'An error occurred while fetching the dashboard data.' });
        }
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


        res.render("admin/sales.ejs", { title: "Sales", items, currentCompany, companies, user });
    },

    transactionDelete: async (req, res) => {

        const transaction_id = req.query.id
        await mysql.query(`DELETE FROM cash_flows WHERE tnx_id = ?`, [transaction_id]);
        await mysql.query(`DELETE FROM sale_products WHERE sale_id = ?`, [transaction_id]);
        await mysql.query(`DELETE FROM sales WHERE id = ?`, [transaction_id]);
        res.redirect('/admin/dashboard')
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

        res.render('admin/transactionDetails', { user, currentCompany, companies, transactionDetails: transactionDetails[0], transactionProducts, previousRoute })
    },


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
        res.render("admin/purchases.ejs", { title: "Sales", items, currentCompany, companies, user });
    },

    viewTransactions: async (req, res) => {
        const companyId = req.session.user.company_id
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
        });
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

        res.render('admin/transactionEdit.ejs', { user, currentCompany, companies, transactionDetails: transactionDetails[0], transactionProducts, parties, products: products[0], current_party: current_party[0], previousRoute })
    },
    transactionEdit: async (req, res) => {
        const { partyName, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, transactionType, transaction_id, } = req.body;
        const products = req.body.products;
        const user = req.session.user;
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id=?`, [partyName])
        const [currentProductsInTransactions] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id=?`,[transaction_id])
        

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
        if(products && products?.length){
        for (let product of products) {
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
                    unit = ?
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
                    product.saleProduct_id
                ]
            );
           
        } 
        if(currentProductsInTransactions.length < products.length){
            for(let i= currentProductsInTransactions.length; i<products.length;i++){
            await mysql.query(`
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
                    unit
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ? ,?)`,
                [
                    products[i].itemId,
                    transaction_id,
                    products[i].quantity,
                    products[i].deliveredQuantity,
                    products[i].pricePerUnit,
                    products[i].discount,
                    products[i].tax,
                    products[i].productTotal,
                    user.company_id,
                    products[i].item,
                    products[i].unit
                ]
            );
        }                
        }
    }
        
        if (transactionType === "purchase") {
            return res.redirect('/admin/purchases');
        }
        res.redirect('/admin/sales');
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

    viewUser: async (req, res) => {
        const currentUser = req.session.user;
        const [users] = await mysql.query("SELECT * FROM users WHERE role = 'businessOwner';")
        res.render('admin/manageUsers.ejs', { users, currentUser })
    },

    addUser: async (req, res) => {
        const { name, email, password } = req.body
        const hashedPassword = await bcrypt.hash(password, 10);
        await mysql.query("INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)", [name, email, hashedPassword, 'businessOwner'])
        // const [addedUser] = await mysql.query("SELECT * FROM users WHERE email = ?", [email])
        // await mysql.query("INSERT INTO companies (user_id,name,created_at) VALUES (?,?,?)", [addedUser[0].id, 'Main', new Date()])
        res.redirect('/admin/userManagement')
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

        const companyId = user.company_id;

        if (!companyId) {
            return res.render("admin/error.ejs", { error: 'No company found for this user.' });
        }

        const [categories] = await mysql.query("SELECT * FROM categories");



        res.render('admin/addItems.ejs', { categories: categories.length > 0 ? categories : [] });
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
                    "SELECT * FROM items WHERE item_name = ? AND user_id = ?",
                    [itemName, user.id]
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
                        category,
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
                        purchasePrice,
                        purchasePriceTaxIncluded || false,
                        taxRate,
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

                res.render('admin/itemManagement.ejs', { items, user, companies, currentCompany });

            } catch (error) {
                console.error(error);
                return res.render('admin/addItems.ejs', { error: 'An error occurred. Please try again.' });
            }
        });
    },


    // Fetch items related to the company
    viewItems: async (req, res) => {
        const user = req.session.user;

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
        res.render('admin/itemManagement.ejs', { items, user: req.session.user });
    },

    // Add new category, linking it to the user's company
    addCategory: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;

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
                success: 'Category added successfully.'
            });
        } catch (error) {
            console.error('Error in addCategory:', error);

            const [categories] = await mysql.query("SELECT * FROM categories");
            return res.render('admin/addItems.ejs', {
                error: 'An error occurred. Please try again.',
                categories
            });
        }
    },
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

        res.render('admin/addTransactions.ejs', { date: today, products: products[0], currentCompany, companies, user, parties, previousRoute });
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

        res.render('admin/addPurchase.ejs', { date: today, products: products[0], currentCompany, companies, user, parties, previousRoute });
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
        if(recieved > 0){
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,tnx_id, company_id, opening_cash, closing_cash) VALUES (?,?,?,?,?,?,?,?,?)`,
            [party[0].PartyName, created_at, transactionType, recieved, money_type, sales[0].insertId, user.company_id, openingCash, closingCash])
        }
        if (products) {
            await mysql.query("INSERT INTO sale_products (sale_id, item_id, quantity, delivered_quantity, price, discount, tax_rate, total,company_id, product_name, unit) VALUES ?", [products.map(product => [sales[0].insertId, product.productId, product.quantity, product.deliveredQuantity, product.pricePerUnit, product.discount, product.tax, product.productTotal, user.company_id, product.item, product.unit])]);

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
            return res.redirect('/admin/purchases');
        }
        res.redirect('/admin/sales');

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
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
        const [results] = await mysql.query(`
            SELECT 
                p.id AS party_id,
                p.PartyName AS party_name,
                p.Phone,
                p.Email,
                p.Address,
                p.profile_picture,
                p.PartyStatus,
                t.id AS transaction_id,
                t.date AS transaction_date,
                t.total_amount AS transaction_amount,
                t.balance_due AS transaction_balance_due,
                t.transaction_type As transaction_type
            FROM 
                parties p
            LEFT JOIN 
                sales t ON p.id = t.customer_name
                WHERE p.company_id = ?
           `,[companyId]);

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
                    partyStatus:row.PartyStatus,
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
                    transaction_type: row.transaction_type
                });
            }
        });

        const parties = Object.values(partiesMap);
        

        res.render('admin/partyDisplay.ejs', { title: 'parties', currentCompany, companies, user, parties });
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
                const { name, email, phone, address } = req.body;

                const image = req.file ? req.file.filename : null;

                await mysql.query(
                    "INSERT INTO parties (user_id, PartyName, Email, Phone, Address, profile_picture,company_id) VALUES (?,?,?,?,?,?,?)",
                    [user.id, name, email, phone, address, image, user.company_id]
                );

                res.redirect('/admin/viewParty');
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

    logout: (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    },
    viewReports: async (req, res) => {
        const [total_profit] = await mysql.query("SELECT (SELECT SUM(total_amount) FROM sales WHERE transaction_type = 'sale') - (SELECT SUM(total_amount) FROM sales WHERE transaction_type = 'purchase') AS total_profit;");
        res.render('admin/reports.ejs', { total_profit });
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
        res.render('admin/expenseDisplay.ejs', { categories: formattedData })
    },

    viewItemProfitAndLoss: async (req, res) => {
        try {
            const user = req.session.user
            const company_id = user.company_id;
            const [results] = await mysql.query(`
                SELECT 
                    i.id AS item_id,
                    i.item_name,
                    COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0) AS total_sales,
                    COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0) AS total_purchases,
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
            
            

            res.render('admin/itemProfitAndLoss.ejs', { results })
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal server error' });
        }

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
        res.render('admin/cashFlows.ejs', { currentCompany, companies, user, cashFlows, closingCash, moneyIn, moneyOut });
    },

    viewDayBook: async (req, res) => {

        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        const [items] = await mysql.query(`
            SELECT * FROM sales
            WHERE company_id = ?
        `, [companyId]);

        res.render('admin/dayBook.ejs', { title: 'Day Book', currentCompany, companies, user, items });
    },
    viewAddExpense: async (req, res) => {
        const [categories] = await mysql.query('SELECT * FROM expense_category');
        res.render('admin/addExpense.ejs', { categories });
    },
    addExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const { category_id, expense_number, date, amount } = req.body
        await mysql.query(`INSERT INTO expenses (category_id,expense_number,date,amount,company_id) VALUES(?,?,?,?,?)`, [category_id, expense_number, date, amount, company_id])
        res.redirect('/admin/dashboard');

    },

    addExpenseCategory: async (req, res) => {
        const { name } = req.body
        await mysql.query(`INSERT INTO expense_category (category_name) VALUES(?)`, [name])
        res.redirect('/admin/expense')
    },

    viewStockReport: async (req, res) => {
        const user = req.session.user;
        const [items] = await mysql.query(`
            SELECT 
                i.id, 
                i.item_name, 
                i.stock, 
                i.unit, 
                i.sale_price,
                COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity ELSE 0 END), 0) AS quantity_out,  -- Total quantity sold
                COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity ELSE 0 END), 0) AS quantity_in  -- Total quantity purchased
            FROM items i
            LEFT JOIN sale_products sp ON i.id = sp.item_id
            LEFT JOIN sales s ON sp.sale_id = s.id
            WHERE i.company_id = ?
            GROUP BY i.id
        `, [user.company_id]);
    
            
    res.render('admin/stockReport.ejs',{items})
    },
    viewAdjustStock:async(req,res)=>{
        const {item_id} = req.query
        res.render('admin/adjustStock',{item_id})
        
    },
    viewAdjustStockDetails:async(req,res)=>{
        const {item_id} = req.query
        const [stock_adjustments] = await mysql.query(`SELECT * FROM stock_adjustments WHERE item_id=?`,[item_id])
        const [item] = await mysql.query(`SELECT * FROM items WHERE id=?`,[item_id])
        res.render('admin/adjustStockDetails.ejs',{stock_adjustments,item:item[0]})
    },
    adjustStock:async(req,res)=>{
        const user = req.session.user
        const company_id = user.company_id
        const{adjustmentType,date,quantity,price,details,item_id} = req.body
        await mysql.query(`
            UPDATE items 
            SET stock = stock + ? 
            WHERE id = ?
        `, [adjustmentType == 'add' ? quantity : -quantity, item_id]);
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
        
        
        res.render('admin/itemEdit.ejs',{item:item[0],user,companies,currentCompany,categories})
        
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

                res.render('admin/itemManagement.ejs', { items, user, companies, currentCompany });

            } catch (error) {
                console.error(error);
                return res.render('admin/itemEdti.ejs', { error: 'An error occurred. Please try again.' });
            }
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
            
            res.render('admin/cashInHand.ejs',{currentCompany,companies:companyData,user,transactionDetails:[...transactionDetails,...expenses],totalCashInHand})
        } catch (error) {
            console.error(error);
            
        }
    },
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
    
        res.render('admin/totalReceivable.ejs', {
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
    
        res.render('admin/totalPayable.ejs', {
            companies: companyData,
            currentCompany: currentCompany,
            partyWisePayable 
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


};

module.exports = adminController;
