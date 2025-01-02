const isLogged = (req,res,next)=>{
    if (!req.session.user || req.session.user.role !== 'businessOwner') {
        return res.redirect('/login');
    }else{
        next()
    }
}

module.exports= {isLogged}