"""Local multiplayer storage auctions. Run: python server.py"""
import json
import random
import secrets
import socket
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOMS = {}
DECK = [('Кассетная дека', 250), ('Промокший ковёр', -100), ('Старый велосипед', 150),
        ('Лампа архитектора', 200), ('Коробка проводов', 0), ('Дубовый стол', 350),
        ('Сервиз с трещиной', 50), ('Золотые часы', 500), ('Сломанный морозильник', -150),
        ('Коллекция пластинок', 300), ('Фотоаппарат', 200), ('Пустой футляр', 0)]

def require(condition, message):
    if not condition:
        raise ValueError(message)

def start_lot(r):
    r['round'] += 1
    r['stage'] = 'setup'
    r['host'] = (r['round'] - 1) % len(r['players'])
    r['cards'] = random.sample(DECK, random.randint(2, 4))
    r.update(price=0, leader=None, passed=[], turn=None, result='')

def assets(p):
    return p['cash'] + sum(value for _, value in p['loot'])

def advance(r, i):
    n = len(r['players'])
    for step in range(1, n + 1):
        j = (i + step) % n
        if j != r['host'] and j != r['leader'] and j not in r['passed']:
            r['turn'] = j
            return
    r.update(stage='sold', turn=None, result='Лот остался без покупателя.')
    if r['leader'] is not None:
        buyer = r['players'][r['leader']]
        buyer['cash'] -= r['price']
        buyer['loot'].extend(r['cards'])
        r['result'] = f"{buyer['name']} покупает склад за {r['price']}."

def dispatch(a):
    op = a.get('op')
    code = str(a.get('code', '')).strip().upper()
    if op in ('create', 'join'):
        name = str(a.get('name', '')).strip()[:24]
        require(name, 'Введите имя.')
        if op == 'create':
            code = ""
            while not code or code in ROOMS:
                code = secrets.token_hex(3).upper()
            ROOMS[code] = dict(players=[], stage='lobby', round=0, version=0)
        require(code in ROOMS, 'Комната не найдена.')
        r = ROOMS[code]
        require(r['stage'] == 'lobby' and len(r['players']) < 7, 'Вход закрыт.')
        require(all(p['name'] != name for p in r['players']), 'Имя уже занято.')
        token = secrets.token_urlsafe(24)
        r['players'].append(dict(name=name, token=token, cash=1500, loot=[]))
        r['version'] += 1
        return dict(code=code, token=token)
    require(code in ROOMS, 'Комната не найдена.')
    r = ROOMS[code]
    i = next((i for i,p in enumerate(r['players']) if p['token'] == a.get('token')), None)
    require(i is not None, 'Войдите в комнату.')
    stage = r['stage']
    if op != 'state':
        require(a.get('version') == r['version'], 'Стол обновился. Повторите ход.')
        if op == 'start':
            require(stage == 'lobby' and i == 0 and len(r['players']) >= 3, 'Нужно 3–7 игроков и создатель комнаты.')
            start_lot(r)
        elif op in ('open', 'bid'):
            amount = a.get('amount')
            require(type(amount) is int and amount >= 50 and amount % 50 == 0, 'Сумма должна быть кратна 50.')
            if op == 'open':
                require(stage == 'setup' and i == r['host'] and amount <= 1500, 'Только ведущий назначает старт (50–1500).')
                r.update(price=amount, stage='bid')
            else:
                require(stage == 'bid' and i == r['turn'], 'Сейчас другой ход.')
                require(amount >= r['price'] + (50 if r['leader'] is not None else 0) and amount <= r['players'][i]['cash'], 'Проверьте размер ставки и баланс.')
                r.update(price=amount, leader=i)
            advance(r, i)
        elif op == 'pass':
            require(stage == 'bid' and i == r['turn'], 'Сейчас другой ход.')
            r['passed'].append(i)
            advance(r, i)
        elif op == 'next':
            require(stage == 'sold' and i == r['host'], 'Лот завершает ведущий.')
            if r['round'] == len(r['players']) * 2:
                r['stage'] = 'end'
            else:
                start_lot(r)
        else:
            raise ValueError('Неизвестный ход.')
        r['version'] += 1
    state = {k:v for k,v in r.items() if k not in ('players','cards')}
    state['me'] = i
    state['players'] = [dict(name=p['name'],cash=p['cash'],total=assets(p)) for p in r['players']]
    state['cards'] = [c if state['stage'] in ('sold','end') or j == 0 or (i == r.get('host') and j == 1) else None for j,c in enumerate(r.get('cards',[]))]
    return state

class Handler(BaseHTTPRequestHandler):
    def send(self, status, data, mime):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.split('?')[0] != '/':
            return self.send_error(404)
        self.send(200, Path(__file__).with_name('index.html').read_bytes(), 'text/html; charset=utf-8')

    def do_POST(self):
        if self.path != '/api':
            return self.send_error(404)
        try:
            size = int(self.headers.get('Content-Length', 0))
            require(0 < size <= 2048, 'Неверный запрос.')
            data = json.loads(self.rfile.read(size))
            require(isinstance(data,dict), 'Неверный запрос.')
            self.send(200,json.dumps(dispatch(data)).encode(),'application/json')
        except ValueError as e:
            self.send(400,json.dumps(dict(error=str(e))).encode(),'application/json')

if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 8080), Handler)
    print('Адреса для телефонов (общая сеть Wi-Fi):', flush=True)
    for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
        print(f'http://{ip}:8080/', flush=True)
    server.serve_forever()
