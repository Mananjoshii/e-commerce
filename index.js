import express from 'express';
import pg from "pg";
import session from 'express-session';
import passport from 'passport';
import { Strategy } from 'passport-local';
import multer from 'multer';
import path from 'path';

const app = express();
const port = 3000;

//Database connection
const db = new pg.Client({
    user: 'postgres',
    host: 'localhost',
    database: 'sweets_db',
    password: '1234',
    port: '5432',
});
db.connect();

//Session middleware
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
})
);

//Passport middleware
app.use(passport.initialize());
app.use(passport.session());


//Middleware
app.use(express.static("public"));

app.set('view engine', 'ejs');
app.set('views', './views');

app.use(express.urlencoded({ extended: true }));

//Middleware to make user available in all views
app.use((req, res, next) => {
    res.locals.user = req.user;
    next();
});

// Set up storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads');
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext);
    }
});

const upload = multer({ storage });

// Handle form submission
app.post('/admin/add-sweet', upload.single('image'), async (req, res) => {
    const { name, price } = req.body;
    const imagePath = '/uploads/' + req.file.filename;

    try {
        await db.query(
            'INSERT INTO sweets (name, price, image_url) VALUES ($1, $2, $3)',
            [name, price, imagePath]
        );
        res.redirect('/admin');
    } catch (err) {
        console.error('Error adding sweet:', err);
        res.send('Error adding sweet');
    }
});


//Routes
app.get('/', async (req, res) => {

    try {
        const sweets = await db.query('SELECT * FROM sweets');
        let selectedCustomer = null;

        if (req.session.selectedCustomerId) {
            const custRes = await db.query('SELECT * FROM users WHERE id = $1', [req.session.selectedCustomerId]);
            selectedCustomer = custRes.rows[0];
        }

        res.render('index', { sweets: sweets.rows, selectedCustomer });
    } catch (err) {
        console.error('Home error:', err);
        res.send('Something went wrong.');
    }
});




//Add to cart route
app.post('/add-to-cart', async (req, res) => {
    if (!req.user) {
        return res.redirect('/register');
    }

    const sweetId = req.body.sweet_id;
    const userId = req.user.id;

    try {
        // Check if item already in cart
        const result = await db.query(
            'SELECT * FROM cart WHERE user_id = $1 AND sweet_id = $2',
            [userId, sweetId]
        );

        if (result.rows.length > 0) {
            // If it exists, just increment quantity
            await db.query(
                'UPDATE cart SET quantity = quantity + 1 WHERE user_id = $1 AND sweet_id = $2',
                [userId, sweetId]
            );
        } else {
            // If not, insert new row
            await db.query(
                'INSERT INTO cart (user_id, sweet_id, quantity) VALUES ($1, $2, 1)',
                [userId, sweetId]
            );
        }

        console.log(`Sweet ${sweetId} added to cart for user ${userId}`);
        res.redirect('/');
    } catch (err) {
        console.error('Error adding sweet to cart:', err);
        res.status(500).send('Something went wrong while adding to cart.');
    }
});


//About, Contact, Login, Register routes
app.get('/about', (req, res) => {
    res.render('about.ejs');
})
app.get('/contact', (req, res) => {
    res.render('contact.ejs');
})
app.get('/login', (req, res) => {
    res.render('login.ejs');
})
app.get('/register', (req, res) => {
    res.render('register.ejs');
})

// Middleware to check if user is admin
app.get('/admin', async (req, res) => {
    try {
        const sweetResult = await db.query('SELECT * FROM sweets');
        const orderResult = await db.query(`
            SELECT orders.*, users.name AS username, users.phnum, sweets.name AS sweetname 
            FROM orders 
            JOIN users ON orders.user_id = users.id 
            JOIN sweets ON orders.sweet_id = sweets.id
            ORDER BY orders.created_at DESC
        `);
        res.render('admin-dashboard', {
            sweets: sweetResult.rows,
            orders: orderResult.rows
        });
    } catch (err) {
        console.error('Error loading admin dashboard:', err);
        res.status(500).send('Internal Server Error');
    }
});


// Delete sweet
app.post('/admin/delete-sweet/:id', async (req, res) => {
    const sweetId = req.params.id;
    try {
        await db.query('DELETE FROM sweets WHERE id = $1', [sweetId]);
        res.redirect('/admin');
    } catch (err) {
        console.error('Error deleting sweet:', err);
        res.status(500).send('Could not delete sweet');
    }
});

// Add agent route
app.post('/admin/add-agent', async (req, res) => {
    const { username, phnum } = req.body;
    if (!username || !phnum) {
        return res.status(400).send("Username and mobile number are required.");
    }
    try {
        // Optional: Check if agent already exists
        const check = await db.query("SELECT * FROM users WHERE phnum = $1", [phnum]);
        if (check.rows.length > 0) {
            return res.send("Agent with this mobile number already exists.");
        }

        // Insert new agent with default name & password if needed
        await db.query(
            "INSERT INTO users (name, role, phnum, password) VALUES ($1, $2, $3, $4)",
            [username, 'agent', phnum, 'agent123'] // Use hashed passwords in production!
        );

        res.redirect('/admin');
    } catch (err) {
        console.error("Error adding agent:", err);
        res.status(500).send("Failed to add agent");
    }
});



//My Cart route
// View Cart
app.get('/my-cart', async (req, res) => {
    if (!req.user) return res.redirect('/login');
    const userId = req.user.id;

    try {
        const cartItems = await db.query(`
  SELECT cart.*, sweets.id AS sweet_id, sweets.name, sweets.image_url, sweets.price
  FROM cart
  JOIN sweets ON cart.sweet_id = sweets.id
  WHERE cart.user_id = $1
`, [req.user.id]);

        res.render("cart", { cart: cartItems.rows });

    } catch (err) {
        console.error('Error loading cart:', err);
        res.status(500).send('Internal Server Error');
    }
});




//login route
app.post('/login', passport.authenticate('local', {
    failureRedirect: '/login',
}), (req, res) => {
    if (req.user.role === 'admin') {
        return res.redirect('/admin');
    }
    else if (req.user.role === 'agent') {
        return res.redirect('/agent/dashboard');
    }
    else {
        return res.redirect('/');
    }
});

//Register route
app.post('/register', (req, res) => {
    const { name, mobile, password } = req.body;

    db.query(
        'INSERT INTO users (name,phnum,password) VALUES ($1, $2,$3) RETURNING *',
        [name, mobile, password],
        (err, result) => {
            if (err) {
                console.error('Error during registration:', err);
                return res.status(500).send('Error during registration');
            }

            const user = result.rows[0];

            // Auto-login after registration
            req.login(user, (err) => {
                if (err) {
                    console.error('Error during login after registration:', err);
                    return res.status(500).send('Error during login');
                }

                res.redirect('/');
            });
        }
    );
});

//Logout route
app.post('/logout', (req, res, next) => {
    req.logout(err => {
        if (err) return next(err);
        res.redirect('/');
    });
});

// Increase Quantity
app.post('/my-cart/add/:id', async (req, res) => {
    const userId = req.user.id;//10
    const sweetId = req.params.id;//11

    try {
        // Validate sweet exists
        const sweet = await db.query('SELECT * FROM CART WHERE id=$1', [sweetId]);
        if (sweet.rows.length == 0) {
            return res.status(400).send('Invalid sweet ID');
        }

        const existing = await db.query(
            'SELECT * FROM cart WHERE user_id = $1 AND sweet_id = $2',
            [userId, sweetId]
        );

        if (existing.rows.length > 0) {
            await db.query(
                'UPDATE cart SET quantity = quantity + 1 WHERE user_id = $1 AND sweet_id = $2',
                [userId, sweetId]
            );
        } else {
            await db.query(
                'INSERT INTO cart (user_id, sweet_id, quantity) VALUES ($1, $2, 1)',
                [userId, sweetId]
            );
        }

        res.redirect('/my-cart');
    } catch (err) {
        console.error('Error adding to cart:', err);
        res.status(500).send('Internal Server Error');
    }
});


// Decrease Quantity
app.post('/my-cart/decrease/:id', async (req, res) => {
    const userId = req.user.id;
    const sweetId = req.params.id;

    try {
        const cartItem = await db.query(
            'SELECT quantity FROM cart WHERE user_id = $1 AND sweet_id = $2',
            [userId, sweetId]
        );

        if (cartItem.rows.length > 0 && cartItem.rows[0].quantity > 1) {
            await db.query(
                'UPDATE cart SET quantity = quantity - 1 WHERE user_id = $1 AND sweet_id = $2',
                [userId, sweetId]
            );
        } else {
            await db.query(
                'DELETE FROM cart WHERE user_id = $1 AND sweet_id = $2',
                [userId, sweetId]
            );
        }

        res.redirect('/my-cart');
    } catch (err) {
        console.error('Error decreasing quantity:', err);
        res.status(500).send('Internal Server Error');
    }
});


// Remove Item Completely
app.post('/my-cart/remove/:id', async (req, res) => {
    const userId = req.user.id;
    const sweetId = req.params.id;

    try {
        await db.query(
            'DELETE FROM cart WHERE user_id = $1 AND sweet_id = $2',
            [userId, sweetId]
        );
        res.redirect('/my-cart');
    } catch (err) {
        console.error('Error removing item:', err);
        res.status(500).send('Internal Server Error');
    }
});




//Checkout route
app.post('/checkout', async (req, res) => {
    const userId = req.user.id;

    try {
        // Just clear the cart here for simplicity
        await db.query('DELETE FROM cart WHERE user_id = $1', [userId]);

        res.send('Thank you for your order! (You can replace this with a success page.)');
    } catch (err) {
        console.error('Checkout error:', err);
        res.status(500).send('Internal Server Error');
    }
});































//Passport local strategy for authentication
passport.use(new Strategy({
    usernameField: 'mobile',
    passwordField: 'password'
}, async function verify(mobile, password, cb) {
    try {
        const result = await db.query('SELECT * FROM users WHERE phnum = $1 AND password = $2', [mobile, password]);
        const user = result.rows[0];
        if (result.rows.length > 0) {
            return cb(null, user);
        } else {
            return cb(null, false, { message: 'Invalid credentials' });
        }
    } catch (err) {
        return done(err);
    }
}
));

// Serialize and deserialize user
passport.serializeUser(function (user, cb) {
    cb(null, user);
});

passport.deserializeUser(async function (user, cb) {
    cb(null, user);
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
})