#!/usr/bin/env python3
"""
Скрипт для генерации иконок расширения Dion Jingles
Требует: pip install Pillow
"""

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Ошибка: требуется библиотека Pillow")
    print("Установите: pip install Pillow")
    exit(1)

import os

def create_icon(size, filename):
    """Создает иконку заданного размера"""
    # Создаем изображение с градиентом
    img = Image.new('RGB', (size, size), color='#667eea')
    draw = ImageDraw.Draw(img)
    
    # Рисуем градиент (упрощенный)
    for i in range(size):
        ratio = i / size
        r = int(102 + (118 - 102) * ratio)  # 667eea -> 764ba2
        g = int(126 + (75 - 126) * ratio)
        b = int(234 + (162 - 234) * ratio)
        draw.rectangle([(0, i), (size, i+1)], fill=(r, g, b))
    
    # Рисуем ноту
    center_x = size // 2
    center_y = size // 2
    radius = size // 4
    
    # Круг (голова ноты)
    draw.ellipse(
        [center_x - radius//2 - radius//3, center_y - radius//2 - radius//3,
         center_x - radius//2 + radius//3, center_y - radius//2 + radius//3],
        fill='white'
    )
    
    # Стебель
    stem_width = max(2, size // 16)
    draw.rectangle(
        [center_x + radius//2 - stem_width//2, center_y - radius,
         center_x + radius//2 + stem_width//2, center_y + radius * 2],
        fill='white'
    )
    
    # Флаг (только для больших размеров)
    if size >= 48:
        flag_points = [
            (center_x + radius//2, center_y - radius),
            (center_x + radius * 2, center_y - radius//2),
            (center_x + radius//2, center_y - radius//3)
        ]
        draw.polygon(flag_points, fill='white')
    
    # Сохраняем
    img.save(filename, 'PNG')
    print(f"Создана иконка: {filename} ({size}x{size})")

def main():
    # Создаем папку icons если её нет
    os.makedirs('icons', exist_ok=True)
    
    # Создаем иконки разных размеров
    sizes = [16, 48, 128]
    for size in sizes:
        filename = f'icons/icon{size}.png'
        create_icon(size, filename)
    
    print("\n✅ Все иконки созданы!")

if __name__ == '__main__':
    main()

