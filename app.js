const express = require('express')
const nocache = require('nocache')
const session = require('express-session');
const path = require('path')

const app = express()

//routes
const adminRoutes = require('./routes/adminRoutes')
const businessOwnerRoutes = require('./routes/businessOwnerRoutes')

// EJS view engine
app.set('view engine','ejs')
app.set('views',path.join(__dirname,'views'))

// middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//using nocache for session manegment
app.use(nocache());

// session middlewares
app.use(
    session({
      secret: "secret key",
      resave: false,
      saveUninitialized: true,
    })
  ); 

// static middlewares
app.use(express.static(path.join(__dirname,'public')))

//routes
app.use(adminRoutes)
app.use(businessOwnerRoutes)



const PORT = 3000;
app.listen(PORT,()=>{
    console.log(`Server is running at http://localhost:${PORT}`);
    
})