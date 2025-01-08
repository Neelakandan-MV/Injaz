const isLogged = (req,res,next)=>{
    if (!req.session.user || req.session.user.role !== 'businessOwner') {
        return res.redirect('/login');
    }else{
        next()
    }
}

const isLoggedAdmin = (req,res,next)=>{
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }else{
        next()
    }
}

const isUserActive = (req,res,next)=>{
    if (req.session.user.status !== 'active') {
        return res.redirect('/login');
    }else{
        next()
    }
}

module.exports= {isLogged,isLoggedAdmin,isUserActive }