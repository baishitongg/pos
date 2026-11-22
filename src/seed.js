// Demo data used on first start (or after `npm run reset`).
// Prices are integer cents to avoid floating-point rounding errors.

const n = (en, zh) => ({ en, zh });
const opt = (id, en, zh, price = 0) => ({ id, name: n(en, zh), price });

const spice = () => ({
  id: 'spice', name: n('Spice level', '辣度'), min: 1, max: 1,
  options: [opt('mild', 'Mild', '小辣'), opt('normal', 'Normal', '中辣'), opt('extra', 'Extra hot', '大辣')],
});
const drinkTemp = (icedExtra = 50) => ({
  id: 'temp', name: n('Hot or iced', '冷/热'), min: 1, max: 1,
  options: [opt('hot', 'Hot', '热'), opt('iced', 'Iced', '冰', icedExtra)],
});
const sugar = () => ({
  id: 'sugar', name: n('Sweetness', '甜度'), min: 1, max: 1,
  options: [opt('normal', 'Normal', '正常'), opt('less', 'Less sweet', '少甜'), opt('none', 'No sugar', '无糖')],
});
const side = () => ({
  id: 'side', name: n('Choose a side', '配菜'), min: 1, max: 1,
  options: [opt('fries', 'Fries', '薯条'), opt('salad', 'Garden salad', '沙拉'), opt('wedges', 'Potato wedges', '薯角', 200)],
});

export function seedData() {
  const categories = [
    { id: 'rice', name: n('Rice & Noodles', '饭面类') },
    { id: 'mains', name: n('Burgers & Grill', '汉堡与烧烤') },
    { id: 'snacks', name: n('Snacks & Sides', '小吃') },
    { id: 'drinks', name: n('Drinks', '饮料') },
    { id: 'dessert', name: n('Desserts', '甜点') },
  ];

  const items = [
    { id: 'nasi-lemak', categoryId: 'rice', emoji: '🍛', color: '#FDE7C8', price: 1490, tags: ['popular', 'spicy'],
      name: n('Nasi Lemak Ayam Goreng', '椰浆饭配炸鸡'), desc: n('Coconut rice, crispy fried chicken, sambal, egg, peanuts & anchovies.', '椰浆饭、香脆炸鸡、参巴酱、鸡蛋、花生与江鱼仔。'),
      optionGroups: [spice(), { id: 'addon', name: n('Add-ons', '加料'), min: 0, max: 3, options: [opt('egg', 'Extra fried egg', '加煎蛋', 200), opt('sambal', 'Extra sambal', '加参巴酱', 150), opt('rendang', 'Beef rendang', '仁当牛肉', 600)] }] },
    { id: 'ckt', categoryId: 'rice', emoji: '🍜', color: '#FBD9C4', price: 1390, tags: ['popular', 'spicy'],
      name: n('Char Kway Teow', '炒粿条'), desc: n('Wok-fried flat noodles with prawns, cockles, bean sprouts and chives.', '大火快炒粿条，配虾、血蚶、豆芽与韭菜。'),
      optionGroups: [spice(), { id: 'addon', name: n('Add-ons', '加料'), min: 0, max: 2, options: [opt('prawn', 'Extra prawns', '加虾', 400), opt('egg', 'Duck egg', '鸭蛋', 200)] }] },
    { id: 'salted-egg', categoryId: 'rice', emoji: '🍚', color: '#FFF1B8', price: 1590, tags: [],
      name: n('Salted Egg Chicken Rice', '咸蛋鸡饭'), desc: n('Golden chicken tossed in creamy salted-egg sauce with curry leaves.', '香酥鸡块裹上浓郁咸蛋酱与咖喱叶。'), optionGroups: [] },
    { id: 'wonton', categoryId: 'rice', emoji: '🥣', color: '#E6F0DA', price: 1190, tags: [],
      name: n('Wonton Noodle Soup', '云吞面汤'), desc: n('Springy egg noodles, pork & prawn wontons, light broth.', '弹牙蛋面、鲜虾猪肉云吞、清汤。'),
      optionGroups: [{ id: 'style', name: n('Style', '做法'), min: 1, max: 1, options: [opt('soup', 'Soup', '汤'), opt('dry', 'Dry (tossed)', '干捞')] }] },

    { id: 'beef-burger', categoryId: 'mains', emoji: '🍔', color: '#F8D7C9', price: 1890, tags: ['popular'],
      name: n('Classic Beef Burger', '经典牛肉汉堡'), desc: n('Grilled beef patty, cheddar, lettuce, tomato and house sauce.', '炭烤牛肉饼、切达芝士、生菜、番茄与特制酱。'),
      optionGroups: [side(), { id: 'addon', name: n('Add-ons', '加料'), min: 0, max: 3, options: [opt('cheese', 'Extra cheese', '加芝士', 200), opt('bacon', 'Beef bacon', '牛肉培根', 400), opt('egg', 'Fried egg', '煎蛋', 200)] }] },
    { id: 'chicken-burger', categoryId: 'mains', emoji: '🍗', color: '#FCE1B4', price: 1690, tags: ['spicy'],
      name: n('Spicy Chicken Burger', '香辣鸡腿堡'), desc: n('Crispy chicken thigh, spicy mayo, pickles, brioche bun.', '香脆鸡腿、辣蛋黄酱、酸黄瓜、布里欧面包。'), optionGroups: [side()] },
    { id: 'salmon', categoryId: 'mains', emoji: '🐟', color: '#FAD4D4', price: 2890, tags: [],
      name: n('Grilled Salmon', '香煎三文鱼'), desc: n('Norwegian salmon with lemon butter, seasonal vegetables.', '挪威三文鱼配柠檬黄油与时蔬。'), optionGroups: [side()] },
    { id: 'flatbread', categoryId: 'mains', emoji: '🍕', color: '#F9E0D0', price: 1590, tags: ['veg'],
      name: n('Margherita Flatbread', '玛格丽特薄饼'), desc: n('Tomato, mozzarella and fresh basil on a crisp flatbread.', '番茄、马苏里拉芝士与新鲜罗勒。'), optionGroups: [] },

    { id: 'truffle-fries', categoryId: 'snacks', emoji: '🍟', color: '#FFF0C2', price: 990, tags: ['popular', 'veg'],
      name: n('Truffle Fries', '松露薯条'), desc: n('Shoestring fries, truffle oil, parmesan.', '细薯条、松露油、帕玛森芝士。'), optionGroups: [] },
    { id: 'wings', categoryId: 'snacks', emoji: '🍗', color: '#FBD3B8', price: 1290, tags: [],
      name: n('Chicken Wings (6 pcs)', '鸡翅（6只）'), desc: n('Crispy wings with your choice of glaze.', '香脆鸡翅，可选酱汁。'),
      optionGroups: [{ id: 'glaze', name: n('Glaze', '酱汁'), min: 1, max: 1, options: [opt('honey', 'Honey garlic', '蜜糖蒜香'), opt('buffalo', 'Buffalo hot', '水牛城辣酱'), opt('salted-egg', 'Salted egg', '咸蛋', 150)] }] },
    { id: 'spring-rolls', categoryId: 'snacks', emoji: '🥟', color: '#E9EFD5', price: 790, tags: ['veg'],
      name: n('Vegetable Spring Rolls', '素春卷'), desc: n('Four golden rolls with sweet chilli dip.', '四条金黄春卷配甜辣酱。'), optionGroups: [] },

    { id: 'lemon-tea', categoryId: 'drinks', emoji: '🍋', color: '#FFF6BF', price: 590, tags: ['popular'],
      name: n('Iced Lemon Tea', '冰柠檬茶'), desc: n('Freshly brewed tea with lemon.', '现泡红茶配新鲜柠檬。'),
      optionGroups: [sugar(), { id: 'size', name: n('Size', '杯型'), min: 1, max: 1, options: [opt('reg', 'Regular', '中杯'), opt('large', 'Large', '大杯', 150)] }] },
    { id: 'teh-tarik', categoryId: 'drinks', emoji: '🧋', color: '#EFDCC6', price: 450, tags: ['popular'],
      name: n('Teh Tarik', '拉茶'), desc: n('Pulled milk tea, frothy and smooth.', '香浓顺滑的拉茶。'), optionGroups: [drinkTemp(), sugar()] },
    { id: 'americano', categoryId: 'drinks', emoji: '☕', color: '#E7DCD3', price: 690, tags: [],
      name: n('Americano', '美式咖啡'), desc: n('Double shot espresso with water.', '双份浓缩咖啡加水。'), optionGroups: [drinkTemp(100)] },
    { id: 'orange-juice', categoryId: 'drinks', emoji: '🍊', color: '#FFE2BF', price: 890, tags: ['veg'],
      name: n('Fresh Orange Juice', '鲜榨橙汁'), desc: n('Squeezed to order. No added sugar.', '现榨，无添加糖。'), optionGroups: [] },

    { id: 'mango-sago', categoryId: 'dessert', emoji: '🥭', color: '#FFE7B3', price: 890, tags: ['veg'],
      name: n('Mango Sago', '杨枝甘露'), desc: n('Mango, pomelo, sago pearls and coconut milk.', '芒果、柚子、西米与椰奶。'), optionGroups: [] },
    { id: 'lava-cake', categoryId: 'dessert', emoji: '🍫', color: '#E8D6CF', price: 1290, tags: ['popular'],
      name: n('Chocolate Lava Cake', '熔岩巧克力蛋糕'), desc: n('Warm molten centre, served with vanilla ice cream.', '温热流心，配香草冰淇淋。'), optionGroups: [] },
    { id: 'ice-cream', categoryId: 'dessert', emoji: '🍨', color: '#F6DDE8', price: 790, tags: ['veg'],
      name: n('Ice Cream (2 scoops)', '冰淇淋（两球）'), desc: n('Pick up to two flavours.', '最多选两种口味。'),
      optionGroups: [{ id: 'flavour', name: n('Flavours', '口味'), min: 1, max: 2, options: [opt('vanilla', 'Vanilla', '香草'), opt('chocolate', 'Chocolate', '巧克力'), opt('matcha', 'Matcha', '抹茶'), opt('durian', 'Durian', '榴莲', 200)] }] },
  ].map((it) => ({ available: true, ...it }));

  const tables = Array.from({ length: 12 }, (_, i) => ({
    id: `T${i + 1}`, name: `Table ${i + 1}`, v: 1, active: true, sessionId: null,
  }));

  return {
    schema: 1,
    menuVersion: 1,
    categories,
    items,
    tables,
    orders: [],
    requests: [],
    users: [],
    counter: { date: '', n: 0 },
  };
}
