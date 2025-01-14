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




const businessOwnerController = {

    // Fetch sales for the logged-in user's company
    viewPurchases: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
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
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
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
            const [companyData] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
            const companyId = user.company_id;
            const currentCompany = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

            if (!companyId) {
                return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
            }


            const [sales] = await mysql.query(`
                SELECT * FROM sales
                WHERE company_id = ?
            `, [companyId]);

            // const totalReceivable = sales.reduce((acc, sale) => {
            //     if (sale.transaction_type === 'sale') {
            //         return acc + Number(sale.balance_due);
            //     }
            //     return acc;
            // }, 0);

            // const totalPayable = sales.reduce((acc, sale) => {
            //     if (sale.transaction_type === 'purchase') {
            //         return acc + Number(sale.balance_due); // Convert string to number
            //     }
            //     return acc; // Ensure to return the accumulator for other transaction types
            // }, 0);
            // Fetch transactions from cash_flows table
            const [cashFlows] = await mysql.query(`
            SELECT * FROM cash_flows
            WHERE company_id = ?
        `, [companyId]);


            const totalReceivable = cashFlows.reduce((acc, flow) => {
                if (flow.money_type === 'money_in') {
                    return acc + Number(flow.amount);
                }
                return acc;
            }, 0);

            const totalPayable = cashFlows.reduce((acc, flow) => {
                if (flow.money_type === 'money_out') {
                    return acc + Number(flow.amount);
                }
                return acc;
            }, 0);

            res.render('businessOwner/dashboard.ejs', { title: "Dashboard", transactions: sales, totalReceivable, totalPayable, user, currentCompany: currentCompany[0], companies: companyData, apiKey });
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            res.render('businessOwner/error.ejs', { error: 'An error occurred while fetching the dashboard data.' });
        }
    },

    viewAddItems: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);

        res.render('businessOwner/addItems.ejs', { categories: categories.length > 0 ? categories : [], companies, currentCompany, user,error:null });
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
                    const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
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
                    return res.render('businessOwner/addItems.ejs', { items, error: 'Product with the same name or code already exists.',user,categories,companies,currentCompany });
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

    viewEditItems:async(req,res)=>{
        const {item_id} = req.query
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);


        const [item] = await mysql.query(`SELECT * FROM items WHERE id=?`,[item_id])
        
        res.render('businessOwner/itemEdit.ejs',{item:item[0],user,companies,currentCompany,categories})
        
    },

    editItems:async(req,res)=>{
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

            const [currentItem] = await mysql.query(`SELECT * FROM items WHERE id=?`,[item_id]);

            
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
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
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

            
        res.render('businessOwner/displayItem.ejs', { items, user, currentCompany, companies });
    },

    deleteItem:async(req,res)=>{
        try{
            const {item_id} = req.query

            await mysql.query(`DELETE FROM items WHERE id = ?`, [item_id]);
        }catch(error){
            console.error(error);
            // res.send('Item already in use, Cannot be deleted')
        }
        

    },

    // Add new category, linking it to the user's company
    addCategory: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
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
                    categoryError: 'Category Already Exists.',
                    categories, companies, currentCompany, user
                });
            }

            await mysql.query("INSERT INTO categories (category, user_id, company_id) VALUES (?, ?, ?)", [category, user.id, companyId]);

            const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
            return res.render('businessOwner/addItems.ejs', {
                categories,
                success: 'Category added successfully.', companies, currentCompany, user,error:null
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
    viewAddTransaction: async (req, res) => {

        const user = req.session.user
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE user_id = ?`, [user.id]);
        const today = new Date().toISOString().split('T')[0];
        const companyId = user.company_id;
        const products = await mysql.query("SELECT * FROM items WHERE user_id = ? AND company_id = ?", [user.id, companyId])
        res.render('businessOwner/addTransactions.ejs', { date: today, products: products[0], currentCompany, companies, user, parties });
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
        const money_type = transactionType === 'sale' ? 'money_in' : 'money_out';
        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,tnx_id, company_id) VALUES (?,?,?,?,?,?,?)`,
            [party[0].PartyName, created_at, transactionType, recieved, money_type, sales[0].insertId, user.company_id])

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


        res.redirect('/business-owner/dashboard');
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
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
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
                t.balance_due AS transaction_balance_due
            FROM 
                parties p
            LEFT JOIN 
                sales t ON p.id = t.customer_name
            WHERE 
                p.user_id = ?`, [user.id]);

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
                    balance_due: row.transaction_balance_due
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

        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        // const [items] = await mysql.query(`
        //     SELECT * FROM sales
        //     WHERE company_id = ?
        // `, [companyId]);

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
        `, [companyId]);

        res.render('businessOwner/dayBook.ejs', { title: 'Day Book', currentCompany, companies, user, items });
    },

    viewCashFlow: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [cashFlows] = await mysql.query(`SELECT * FROM cash_flows WHERE company_id = ?`, [companyId])

        res.render('businessOwner/cashFlow.ejs', { currentCompany, companies, user, cashFlows });
    },

    transactionDetails: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const transaction_id = req.query.id
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [transactionDetails] = await mysql.query(`SELECT * FROM sales WHERE id = ?`, [transaction_id])
        const [transactionProducts] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id = ?`, [transaction_id])


        res.render('businessOwner/transactionDetails', { user, currentCompany, companies, transactionDetails: transactionDetails[0], transactionProducts })
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
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [transactionDetails] = await mysql.query(`SELECT * FROM sales WHERE id = ?`, [transaction_id])
        const [transactionProducts] = await mysql.query(`SELECT * FROM sale_products WHERE sale_id = ?`, [transaction_id])
        const [parties] = await mysql.query(`SELECT * FROM parties WHERE user_id = ?`, [user.id]);
        const products = await mysql.query("SELECT * FROM items WHERE user_id = ? AND company_id = ?", [user.id, companyId])
        const [current_party] = await mysql.query('SELECT * FROM parties WHERE id = ?',transactionDetails[0].customer_name)
        

        

        res.render('businessOwner/transactionEdit.ejs', { user, currentCompany, companies, transactionDetails: transactionDetails[0], transactionProducts, parties, products: products[0],current_party:current_party[0] })
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
        res.redirect('/business-owner/dashboard');
    },

    viewItemDetail: async (req, res) => {
        const { itemId } = req.query;
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

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
                items.user_id = ?
            GROUP BY 
                items.id;
        `, [itemId,user.id]);




            res.render('businessOwner/itemDetailReport.ejs', { itemDetails, companies, user, currentCompany })

        } catch (error) {
            console.error("Error fetching item details:", error);
            res.status(500).json({ success: false, error: 'Failed to fetch item details.' });
        }
    },

    viewExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
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
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
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
    }




}

module.exports = businessOwnerController;
