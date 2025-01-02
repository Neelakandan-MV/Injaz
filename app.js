const express = require('express');
const session = require('express-session');
const pool = require('./mySql');


const path = require('path');
const nocache = require('nocache');
const loginRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const businessRoutes = require('./routes/businessRoutes');

const app = express();

// Set up EJS view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(nocache());
app.use(session({
  secret: 'secret key',
  resave: false,
  saveUninitialized: true
}));



app.get('/', (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    } else if (req.session.user.role === 'businessOwner') {
      return res.redirect('/business-owner/dashboard');
    }
  } else {
    res.render('auth/login', { error: null }); // Render login page if not logged in
  }
});

// Use routes
app.use(loginRoutes);
app.use(adminRoutes);
app.use(businessRoutes);



//mysql
async function testConnection() {
  try {
    await pool.query('SELECT 1');
    console.log('MySQL connected successfully!');
  } catch (error) {
    console.error('Error connecting to MySQL:', error);
  }
}
testConnection();


app.listen(3000, () => {
        console.log('Server is running on http://localhost:3000');
      })
