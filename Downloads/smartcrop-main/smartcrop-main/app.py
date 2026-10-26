from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, session
import sqlite3

app = Flask(__name__)
app.secret_key = 'your_secret_key_here'

# SQLite Database Configuration
def get_db_connection():
    conn = sqlite3.connect('users.db')
    conn.row_factory = sqlite3.Row
    return conn

# Initialize Database
def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL,
            state TEXT NOT NULL,
            district TEXT NOT NULL,
            language TEXT NOT NULL,
            password TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Create a default admin user if not exists
    cursor.execute("SELECT * FROM users WHERE email = 'admin@agroai.com'")
    admin = cursor.fetchone()
    if not admin:
        cursor.execute('''
            INSERT INTO users (name, email, phone, state, district, language, password)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', ('Admin User', 'admin@agroai.com', '9999999999', 'Maharashtra', 'Pune', 'English', 'admin123'))
    conn.commit()
    conn.close()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/signup')
def signup():
    return render_template('signup.html')

@app.route('/login')
def login():
    return render_template('login.html')

@app.route('/submit_signup', methods=['POST'])
def submit_signup():
    name = request.form['name']
    email = request.form['email']
    phone = request.form['phone']
    state = request.form['state']
    district = request.form['district']
    language = request.form['language']
    password = request.form['password']
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    existing_user = cursor.fetchone()
    if existing_user:
        flash('Email already registered. Please use a different email.', 'error')
        return redirect(url_for('signup'))
    try:
        cursor.execute('''
            INSERT INTO users (name, email, phone, state, district, language, password)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (name, email, phone, state, district, language, password))
        conn.commit()
        flash('Signup successful! Please login to continue.', 'success')
        return redirect(url_for('login'))
    except Exception as e:
        conn.rollback()
        flash(f'Error: {str(e)}', 'error')
        return redirect(url_for('signup'))
    finally:
        cursor.close()
        conn.close()

@app.route('/submit_login', methods=['POST'])
def submit_login():
    email = request.form['email']
    password = request.form['password']
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ? AND password = ?", (email, password))
    user = cursor.fetchone()
    if user:
        session['user_id'] = user['id']
        session['user_name'] = user['name']
        session['user_email'] = user['email']
        flash('Login successful!', 'success')
        return redirect(url_for('dashboard'))
    else:
        flash('Invalid email or password. Please try again.', 'error')
        return redirect(url_for('login'))

@app.route('/dashboard')
def dashboard():
    if 'user_id' not in session:
        flash('Please log in to access the dashboard.', 'error')
        return redirect(url_for('login'))
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (session['user_id'],))
    user = cursor.fetchone()
    cursor.close()
    conn.close()
    return render_template('dashboard.html', user=user)

@app.route('/users_boarded')
def users_boarded():
    if 'user_id' not in session:
        flash('Please log in to access this page.', 'error')
        return redirect(url_for('login'))
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users")
    users = cursor.fetchall()
    cursor.close()
    conn.close()
    return render_template('users_boarded.html', users=users)

@app.route('/logout')
def logout():
    session.clear()
    flash('You have been logged out.', 'info')
    return redirect(url_for('index'))

@app.route('/delete_user/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    if 'user_id' not in session:
        return jsonify({"success": False, "error": "Not logged in"})
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)})
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(port=5000, debug=True)
