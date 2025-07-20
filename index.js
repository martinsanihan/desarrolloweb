import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import express from 'express';
import { engine } from 'express-handlebars';
import bcrypt from 'bcryptjs';

const CLAVE_SECRETA = 'sedavueltaelsemestre123';
const AUTH_COOKIE_NAME = 'segurida';

//base de datos cristóbal
const sql = neon('postgresql://neondb_owner:tgmUJR2F6Lqo@ep-sparkling-math-a4mdqpl7-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.set('views', './views');
app.use('/files', express.static('public'));

// Ruta principal
app.get('/', async (req, res) => {
  const lista = await sql('SELECT * FROM products');
  res.render('home', { lista });
});

// Ruta para iniciar sesión
app.get('/login', (req, res) => {
  const error = req.query.error;
  res.render('login', { error });
});

// Ruta para registro
app.get('/signup', (req, res) => {
  res.render('signup');
});

// Ruta para manejo de inicio de sesión (POST)
app.post('/login', async (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  const query = 'SELECT id, password FROM users WHERE email = $1';
  const results = await sql(query, [email]);
  if(results.length === 0) {
    res.redirect(302, '/login?error=unauthorized');
    return;
  }

  const id = results[0].id;
  const hash = results[0].password;

  if(bcrypt.compareSync(password, hash)) {
    const fiveMinutesInSecs = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = jwt.sign(
      { id, exp: fiveMinutesInSecs },
      CLAVE_SECRETA
    );

    res.cookie(AUTH_COOKIE_NAME, token, { maxAge: 60 * 60 * 1000 });
    res.redirect(302, '/profile');
    return;
  }

  res.redirect('/login?error=unauthorized');
});

// Ruta para manejo de registro de usuario (POST)
app.post('/signup', async (req, res) => {
  const name = req.body.username;
  const email = req.body.email;
  const password = req.body.password;

  const hash = bcrypt.hashSync(password, 5);
  const query = 'INSERT INTO users (name, email, balance, password) VALUES ($1, $2, $3, $4) RETURNING id';
  try {
    const results = await sql(query, [name, email, 0, hash]);
    const id = results[0].id;

    const fiveMinutesInSecs = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = jwt.sign({ id, exp: fiveMinutesInSecs }, CLAVE_SECRETA);

    res.cookie(AUTH_COOKIE_NAME, token, { maxAge: 60 * 60 * 1000 });
    res.redirect(302, '/profile');
  } catch {
    res.render('alreadyRegistered');
  }
});

// Ruta para registrar administradores
app.post('/adminsignup', async (req, res) => {
  const name = req.body.username;
  const email = req.body.email;
  const password = req.body.password;

  const hash = bcrypt.hashSync(password, 5);
  const query = 'INSERT INTO users (name, email, balance, password, is_admin) VALUES ($1, $2, $3, $4, $5) RETURNING id';
  try {
    const results = await sql(query, [name, email, 0, hash, true]);
    const id = results[0].id;

    const fiveMinutesInSecs = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = jwt.sign({ id, exp: fiveMinutesInSecs }, CLAVE_SECRETA);

    res.cookie(AUTH_COOKIE_NAME, token, { maxAge: 60 * 60 * 1000 });
    res.redirect(302, '/admin');
  } catch {
    res.render('alreadyRegistered');
  }
});

// Middleware de autenticación
const authMiddleware = async (req, res, next) => {
  const token = req.cookies[AUTH_COOKIE_NAME];

  try {
    req.user = jwt.verify(token, CLAVE_SECRETA);
    const results = await sql('SELECT * FROM users WHERE id = $1', [req.user.id]);
    req.user = results[0];
    req.user.salutation = `Hola ${req.user.name}`;
    next();
  } catch (e) {
    res.render('unauthorized');
  }
};
// Middleware de autenticación de admin
const adminAuthMiddleware = async (req, res, next) => {
  const token = req.cookies[AUTH_COOKIE_NAME];

  try {
    req.user = jwt.verify(token, CLAVE_SECRETA);
    const results = await sql('SELECT * FROM users WHERE id = $1', [req.user.id]);
    req.user = results[0];
    req.user.salutation = `Hola ${req.user.name}`;
    if(req.user.is_admin){
      next();
    } else {
      res.render('unauthorizedadmin');
    }
  } catch (e) {
    res.render('unauthorized');
  }
};
// Ruta de perfil del usuario autenticado
app.get('/profile', authMiddleware, async (req, res) => {
  const user_id = req.user.id;
  const query = 'SELECT name, email, balance FROM users WHERE id = $1';
  const results = await sql(query, [user_id]);
  const user = results[0];

  res.render('profile', user)
});

// Cerrar sesión del usuario
app.get('/logout', (req, res) => {
  res.cookie(AUTH_COOKIE_NAME, '', { maxAge: 1 });
  res.render('logout');
});

// Añadir products al cart
app.post('/cart/agregar', authMiddleware, async (req, res) => {
  const user_id = req.user.id;
  const { product_id, quantity } = req.body;

  // Verificar si el products ya está en el cart
  const query = 'SELECT * FROM cart WHERE user_id = $1 AND product_id = $2';
  const existingProduct = await sql(query, [user_id, product_id]);

  if (existingProduct.length > 0) {
    // Si el products ya está en el cart, actualizar la quantity
    const updateQuery = 'UPDATE cart SET quantity = quantity + $1 WHERE user_id = $2 AND product_id = $3';
    await sql
(updateQuery, [quantity, user_id, product_id]);
  } else {
    // Si no está en el cart, insertarlo
    const insertQuery = 'INSERT INTO cart (user_id, product_id, quantity) VALUES ($1, $2, $3)';
    await sql
(insertQuery, [user_id, product_id, quantity]);
  }

  res.redirect('/cart');

});

// Ver el cart del usuario
app.get('/cart', authMiddleware, async (req, res) => {
  const user_id = req.user.id;
try{
    const query = `SELECT p.id, p.name, p.image,   c.quantity, SUM(c.quantity * p.price) as price, SUM(c.quantity * p.price) OVER () as total
  FROM cart c
  JOIN products p ON c.product_id = p.id
  WHERE c.user_id = $1
  GROUP BY p.id, p.name, p.image, c.quantity, p.price
    `;
  
    const cart = await sql(query, [user_id]);
    const total = cart[0].total;
  
    res.render('cart', { cart, total });
} catch(e) {
  res.render('cart');
}
});

// **NUEVAS FUNCIONES QUE FALTABAN**

// Ruta para mostrar el detalle de un products
app.get('/products/:id', async (req, res) => {
  const productsId = req.params.id;
  const query = 'SELECT * FROM products WHERE id = $1';
  const results = await sql(query, [productsId]);

  if (results.length === 0) {
    res.status(404).send("Producto no encontrado");
  } else {
    res.render('products', results[0]);
  }
});

// Ruta para eliminar productos del carrito
app.post('/cart/eliminar', authMiddleware, async (req, res) => {
  const user_id = req.user.id;
  const product_id = req.body.product_id;

  const deleteQuery = 'DELETE FROM cart WHERE user_id = $1 AND product_id = $2';
  await sql(deleteQuery, [user_id, product_id]);

  res.redirect('/cart');
});

// Ruta para comprar (elimina todo y descuenta o sino da error)
app.post('/cart/vaciar', authMiddleware, async (req, res) => {
  const user_id = req.user.id;
  const saldo = req.user.balance;
  const pagoTotal = req.body.pagototal;

  if(saldo - pagoTotal < 0) {
    res.send('no tienes suficientes fondos en tu billetera digital');
    return;
  }
  
  try {
    const clearQuery = 'DELETE FROM cart WHERE user_id = $1';
    await sql(clearQuery, [user_id]);
    await sql('UPDATE users SET balance = balance - $1 WHERE id = $2', [pagoTotal, user_id]);
    await sql('insert into sales (user_id, amount) values ($1, $2)', [user_id, pagoTotal]);

    res.redirect('/cart');
  } catch(e) {
      res.send('Aquí no hay nada para comprar');
  }
});

// Ruta para mostrar el historial de compras
app.get('/historial', authMiddleware, async (req, res) => {
  const user_id = req.user.id;
  const query = `
    SELECT id, sale_date,  amount
    FROM sales
    WHERE user_id = $1
  `;

  const historial = await sql(query, [user_id]);

  res.render('historial', { historial });
});

//ruta de la pagina de administración
app.get('/admin', adminAuthMiddleware, async (req, res) => {
  const productos = await sql('SELECT * FROM products');
  const totalGanado = await sql('select sum(amount) as total from sales');
  const total = totalGanado[0].total;
  res.render('admin', { productos, total });
});

//ruta para formulario de creacion de producto
app.get('/admin2' , (req, res) => {
  res.render('admin2');
})

//ruta para crear producto
app.post('/producto/crear', adminAuthMiddleware, async (req, res) => {
  const { name, price, image } = req.body;
  const query = 'INSERT INTO products (name, price, image) VALUES ($1, $2, $3)';
  await sql(query, [name, price, image]);

  res.redirect('/admin');
});

//ruta para formulario de edicion de producto
app.get('/producto/editar/:id', adminAuthMiddleware, async (req, res) => {
  const productsId = req.params.id;
  const query = 'SELECT * FROM products WHERE id = $1';
  const results = await sql(query, [productsId]);

  res.render('admin3', results[0]);
});

//ruta para editar producto
app.post('/producto/editar', adminAuthMiddleware, async (req, res) => {
  const { id, name, price, image } = req.body;
  const query = `UPDATE products
  SET name = $1, price = $2, image = $3
  WHERE id = $4`;
  await sql(query, [name, price, image, id]);

  res.redirect('/admin');
});

//ruta para pagina de wallet
app.get('/wallet', authMiddleware, async (req, res) => {
  const user_id = req.user.id;
  const query = 'SELECT * FROM users WHERE id = $1';
  const results = await sql(query, [user_id]);
  
  res.render('wallet', results[0]);
});

//formulario para agregar dinero
app.get('/agregardinero', authMiddleware, async (req, res) => {
  res.render('agregardinero');
});

//ruta para agregar dinero
app.post('/agregardinero', authMiddleware, async (req, res) => {
  const user_id = req.user.id;
  const { dinero } = req.body;
  const query = 'UPDATE users SET balance = balance + $1 WHERE id = $2';
  await sql(query, [dinero, user_id]);

  res.redirect('/profile');
});

//ruta para registrar administradores
app.get('/adminsignup', (req, res) => {
  res.render('adminsignup');
});

app.get('/products/category/:id', async (req, res) => {
  const id = req.params.id;
  const query = `select p.name, p.price, p.image, c.id_categoria, c.name_categoria from products p
  join categoria c on c.id_categoria = p.id_categoria
  where c.id_categoria = $1`;
  const results = await sql(query, [id]);

  res.render('categoria', { results });
});

app.post('/producto/eliminar/:id', async (req, res) => {
  const id = req.params.id;
  const query = 'delete from products where id = $1';
  await sql(query, [id]);
  res.redirect('/admin');
});

app.listen(3000, () => console.log('Mostrando Página'));
