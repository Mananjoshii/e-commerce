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
            JOIN users ON orders.customer_id = users.id 
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
        return res.redirect('/agent');
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

//Agent Dashboard
app.get('/agent', async (req, res) => {
    if (!req.user || req.user.role !== 'agent') {
        return res.redirect('/login');
    }

    const agentId = req.user.id;
    const selectedCustomerId = req.query.selectedCustomer;

    try {
        // Get customers for this agent
        const customersResult = await db.query(
            `SELECT * FROM agent_customers WHERE agent_id = $1`,
            [agentId]
        );

        let selectedCustomer = null;
        let sweets = [];
        let cart = [];

        if (selectedCustomerId) {
            // Fetch selected customer
            const customerResult = await db.query(
                `SELECT * FROM agent_customers WHERE id = $1 AND agent_id = $2`,
                [selectedCustomerId, agentId]
            );
            selectedCustomer = customerResult.rows[0];

            if (selectedCustomer) {
                // Get sweets list
                const sweetsResult = await db.query(`SELECT * FROM sweets`);
                sweets = sweetsResult.rows;

                // Get cart for selected customer
                const cartResult = await db.query(
                    `SELECT s.name, s.price, c.quantity
                     FROM agent_cart c
                     JOIN sweets s ON c.sweet_id = s.id
                     WHERE c.customer_id = $1`,
                    [selectedCustomerId]
                );
                cart = cartResult.rows;
            }
        }

        res.render('agent', {
            customers: customersResult.rows,
            selectedCustomer,
            sweets,
            cart
        });
    } catch (err) {
        console.error('Error loading agent dashboard:', err);
        res.status(500).send('Internal Server Error');
    }
});


// Select a customer from dropdown
app.post('/agent/select-customer', async (req, res) => {
  const { customer_id } = req.body;

  try {
    // Redirect back to agent dashboard with selected customer in query
    res.redirect('/agent?selectedCustomer=' + customer_id);
  } catch (err) {
    console.error('Error selecting customer:', err);
    res.status(500).send('Error selecting customer');
  }
});

app.post('/agent/add-customer', async (req, res) => {
    const { name, phone, address } = req.body;
    const agentId = req.user.id;

    await db.query(
        `INSERT INTO agent_customers (agent_id, name, phone, address)
         VALUES ($1, $2, $3, $4)`,
        [agentId, name, phone, address]
    );

    res.redirect('/agent');
});


app.get('/agent/cart/:customerId', async (req, res) => {
    const { customerId } = req.params;

    const sweets = await db.query('SELECT * FROM sweets');
    const cartItems = await db.query(
        `SELECT c.*, s.name, s.image_url, s.price
         FROM agent_cart c
         JOIN sweets s ON s.id = c.sweet_id
         WHERE c.customer_id = $1`,
        [customerId]
    );

    res.render('agent-cart', {
        customerId,
        sweets: sweets.rows,
        cart: cartItems.rows,
    });
});

app.post('/agent/cart/add/:customerId/:sweetId',async (req, res) => {
    const { customerId, sweetId } = req.params;

    const existing = await db.query(
        'SELECT * FROM agent_cart WHERE customer_id = $1 AND sweet_id = $2',
        [customerId, sweetId]
    );

    if (existing.rows.length > 0) {
        await db.query(
            'UPDATE agent_cart SET quantity = quantity + 1 WHERE customer_id = $1 AND sweet_id = $2',
            [customerId, sweetId]
        );
    } else {
        await db.query(
            'INSERT INTO agent_cart (customer_id, sweet_id, quantity) VALUES ($1, $2, 1)',
            [customerId, sweetId]
        );
    }

    res.redirect(`/agent/cart/${customerId}`);
});

app.post('/agent/cart/remove/:customerId/:sweetId',  async (req, res) => {
    const { customerId, sweetId } = req.params;

    await db.query(
        'DELETE FROM agent_cart WHERE customer_id = $1 AND sweet_id = $2',
        [customerId, sweetId]
    );

    res.redirect(`/agent/cart/${customerId}`);
});

app.post('/agent/order/checkout/:customerId',  async (req, res) => {
    const { customerId } = req.params;

    const cart = await db.query(
        'SELECT * FROM agent_cart WHERE customer_id = $1',
        [customerId]
    );

    for (const item of cart.rows) {
        await db.query(
            `INSERT INTO orders (customer_id, sweet_id, quantity, agent_id)
             VALUES ($1, $2, $3, $4)`,
            [customerId, item.sweet_id, item.quantity, req.user.id]
        );
    }

    await db.query('DELETE FROM agent_cart WHERE customer_id = $1', [customerId]);

    res.send('Order placed successfully!');
});

// Add sweet to agent's cart
app.post('/agent/add-to-cart', async (req, res) => {
  const { sweet_id, customer_id, quantity } = req.body;

  try {
    await db.query(
      `INSERT INTO agent_cart (customer_id, sweet_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, sweet_id) DO UPDATE SET quantity = agent_cart.quantity + $3`,
      [customer_id, sweet_id, quantity]
    );
    res.redirect('/agent?selectedCustomer=' + customer_id);
  } catch (err) {
    console.error('Error adding to cart:', err);
    res.status(500).send('Error adding to cart');
  }
});

// Place order for selected customer
app.post('/agent/place-order', async (req, res) => {
  const { customer_id } = req.body;

  try {
    // Fetch cart items
    const cartResult = await db.query(
      `SELECT ac.sweet_id, s.price, ac.quantity
       FROM agent_cart ac
       JOIN sweets s ON ac.sweet_id = s.id
       WHERE ac.customer_id = $1`,
      [customer_id]
    );

    const cartItems = cartResult.rows;

    if (cartItems.length === 0) {
      return res.send('Cart is empty. Nothing to order.');
    }

    // Insert into orders table (you can create agent_orders or use orders)
    for (const item of cartItems) {
      await db.query(
        `INSERT INTO agent_orders (customer_id, sweet_id, quantity, total_price)
         VALUES ($1, $2, $3, $4)`,
        [customer_id, item.sweet_id, item.quantity, item.price * item.quantity]
      );
    }

    // Clear agent cart
    await db.query(`DELETE FROM agent_cart WHERE customer_id = $1`, [customer_id]);

    res.redirect('/agent?selectedCustomer=' + customer_id);
  } catch (err) {
    console.error('Error placing order:', err);
    res.status(500).send('Error placing order');
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