import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../pharmacy/pharmacy_detail_screen.dart';

class SearchMapScreen extends StatefulWidget {
  const SearchMapScreen({super.key});

  @override
  State<SearchMapScreen> createState() => _SearchMapScreenState();
}

class _SearchMapScreenState extends State<SearchMapScreen> {
  int _selectedPin = 0;

  final List<Map<String, dynamic>> _pharmacies = [
    {
      'name': 'Pharmacie du Soleil',
      'neighborhood': 'Omnisports, Yaoundé',
      'price': 1250,
      'isGuard': true,
      'x': 0.45,
      'y': 0.35,
    },
    {
      'name': 'Pharmacie Mfoundi Centre',
      'neighborhood': 'Centre-ville, Yaoundé',
      'price': 1400,
      'isGuard': false,
      'x': 0.65,
      'y': 0.55,
    },
    {
      'name': 'Pharmacie de Bastos',
      'neighborhood': 'Bastos, Yaoundé',
      'price': 950,
      'isGuard': true,
      'x': 0.25,
      'y': 0.65,
    },
  ];

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final selected = _pharmacies[_selectedPin];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pharmacies sur la carte'),
      ),
      body: Stack(
        children: [
          // Canvas simulé de carte géographique vectorielle (Yaoundé)
          Positioned.fill(
            child: Container(
              color: isDark ? const Color(0xFF131D1A) : const Color(0xFFE5E9E7),
              child: CustomPaint(
                painter: _MapCanvasPainter(isDark: isDark),
              ),
            ),
          ),

          // Pins de prix interactifs
          LayoutBuilder(
            builder: (context, constraints) {
              return Stack(
                children: List.generate(_pharmacies.length, (index) {
                  final item = _pharmacies[index];
                  final isCurrent = _selectedPin == index;
                  final posX = item['x'] * constraints.maxWidth;
                  final posY = item['y'] * constraints.maxHeight;

                  return Positioned(
                    left: posX - 45,
                    top: posY - 30,
                    child: GestureDetector(
                      onTap: () {
                        setState(() {
                          _selectedPin = index;
                        });
                      },
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 250),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: isCurrent ? AppColors.primary : (isDark ? AppColors.darkCard : Colors.white),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: isCurrent ? Colors.white : AppColors.primary,
                            width: 1.5,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.25),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.local_pharmacy,
                              size: 14,
                              color: isCurrent ? Colors.white : AppColors.primary,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              '${item['price']} XAF',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: isCurrent ? Colors.white : (isDark ? Colors.white : Colors.black87),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                }),
              );
            },
          ),

          // Carte flottante de l'officine sélectionnée
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: isDark ? AppColors.darkSurface : Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.18),
                    blurRadius: 16,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          selected['name'],
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                        ),
                      ),
                      if (selected['isGuard'])
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFF6366F1).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text(
                            'De garde',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF6366F1),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    selected['neighborhood'],
                    style: TextStyle(
                      fontSize: 13,
                      color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Doliprane 500mg : ${selected['price']} XAF',
                        style: const TextStyle(
                          color: AppColors.primary,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      ElevatedButton(
                        onPressed: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (context) => PharmacyDetailScreen(
                                name: selected['name'],
                                neighborhood: selected['neighborhood'],
                                distance: 'Proche',
                                isGuard: selected['isGuard'],
                                phone: '+237 222 00 00 00',
                              ),
                            ),
                          );
                        },
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        child: const Text('Voir l\'officine', style: TextStyle(fontSize: 13)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MapCanvasPainter extends CustomPainter {
  final bool isDark;

  _MapCanvasPainter({required this.isDark});

  @override
  void paint(Canvas canvas, Size size) {
    final roadPaint = Paint()
      ..color = isDark ? const Color(0xFF1E2E2A) : const Color(0xFFCBD5E1)
      ..strokeWidth = 14
      ..style = PaintingStyle.stroke;

    final secondaryRoadPaint = Paint()
      ..color = isDark ? const Color(0xFF182622) : const Color(0xFFE2E8F0)
      ..strokeWidth = 6
      ..style = PaintingStyle.stroke;

    // Tracé de routes schématiques
    final path = Path()
      ..moveTo(0, size.height * 0.4)
      ..quadraticBezierTo(size.width * 0.5, size.height * 0.3, size.width, size.height * 0.5);
    canvas.drawPath(path, roadPaint);

    final path2 = Path()
      ..moveTo(size.width * 0.3, 0)
      ..lineTo(size.width * 0.6, size.height);
    canvas.drawPath(path2, roadPaint);

    final path3 = Path()
      ..moveTo(0, size.height * 0.7)
      ..lineTo(size.width, size.height * 0.8);
    canvas.drawPath(path3, secondaryRoadPaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
