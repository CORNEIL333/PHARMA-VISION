import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import 'search_map_screen.dart';
import '../medicine/medicine_detail_screen.dart';
import '../pharmacy/pharmacy_detail_screen.dart';

class SearchListScreen extends StatefulWidget {
  final String? initialFilter;

  const SearchListScreen({super.key, this.initialFilter});

  @override
  State<SearchListScreen> createState() => _SearchListScreenState();
}

class _SearchListScreenState extends State<SearchListScreen> {
  final TextEditingController _searchController = TextEditingController(text: 'Paracétamol 500mg');
  String _selectedFilter = 'Tous';

  @override
  void initState() {
    super.initState();
    if (widget.initialFilter == 'garde') {
      _selectedFilter = 'De garde';
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Recherche de médicaments'),
        actions: [
          IconButton(
            icon: const Icon(Icons.map_outlined),
            tooltip: 'Vue Carte',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (context) => const SearchMapScreen()),
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Champ de recherche
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Rechercher par DCI, marque ou symptôme...',
                prefixIcon: const Icon(Icons.search_rounded, color: AppColors.primary),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.clear_rounded),
                  onPressed: () => _searchController.clear(),
                ),
              ),
            ),
          ),

          // Filtres rapides
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 6.0),
            child: Row(
              children: [
                _buildFilterChip('Tous'),
                _buildFilterChip('Disponibles'),
                _buildFilterChip('De garde'),
                _buildFilterChip('Prix le plus bas'),
                _buildFilterChip('Génériques'),
              ],
            ),
          ),

          const Divider(height: 1),

          // Liste des résultats
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16.0),
              children: [
                // En-tête des résultats
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '3 officines avec stock confirmé',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                      ),
                    ),
                    Text(
                      'Tri : Distance',
                      style: TextStyle(
                        fontSize: 12,
                        color: isDark ? AppColors.darkTextMuted : AppColors.lightTextMuted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                // Résultat 1 : Grande pharmacie du Soleil
                _buildResultCard(
                  context,
                  pharmacyName: 'Pharmacie du Soleil',
                  neighborhood: 'Omnisports • 350 m',
                  medicineName: 'Doliprane 500mg (16 gélules)',
                  priceXAF: 1250,
                  genericAlternative: 'Alternative : Paracétamol DCI à 600 XAF',
                  isGuard: true,
                  freshnessText: 'Disponible (sync il y a 8 min)',
                  freshnessStatus: 0, // vert
                ),
                const SizedBox(height: 14),

                // Résultat 2 : Pharmacie Mfoundi
                _buildResultCard(
                  context,
                  pharmacyName: 'Pharmacie Mfoundi Centre',
                  neighborhood: 'Centre-ville • 1,2 km',
                  medicineName: 'Efferalgan 500mg effervescent',
                  priceXAF: 1400,
                  genericAlternative: null,
                  isGuard: false,
                  freshnessText: 'À confirmer auprès de l\'officine',
                  freshnessStatus: 1, // orange
                ),
                const SizedBox(height: 14),

                // Résultat 3 : Pharmacie Bastos
                _buildResultCard(
                  context,
                  pharmacyName: 'Pharmacie de Bastos',
                  neighborhood: 'Bastos • 2,1 km',
                  medicineName: 'Paracétamol Biogaran 500mg',
                  priceXAF: 950,
                  genericAlternative: 'Générique direct en stock',
                  isGuard: true,
                  freshnessText: 'Disponible (sync il y a 22 min)',
                  freshnessStatus: 0,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label) {
    final isSelected = _selectedFilter == label;
    return Padding(
      padding: const EdgeInsets.only(right: 8.0),
      child: FilterChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (val) {
          setState(() {
            _selectedFilter = label;
          });
        },
        selectedColor: AppColors.primaryLight,
        checkmarkColor: AppColors.primary,
        labelStyle: TextStyle(
          color: isSelected ? AppColors.primaryDark : null,
          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          fontSize: 13,
        ),
      ),
    );
  }

  Widget _buildResultCard(
    BuildContext context, {
    required String pharmacyName,
    required String neighborhood,
    required String medicineName,
    required int priceXAF,
    required String? genericAlternative,
    required bool isGuard,
    required String freshnessText,
    required int freshnessStatus,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      decoration: BoxDecoration(
        color: isDark ? AppColors.darkCard : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(isDark ? 0.2 : 0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // En-tête pharmacie
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  pharmacyName,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
              if (isGuard)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: const Color(0xFF6366F1).withOpacity(0.12),
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
            neighborhood,
            style: TextStyle(
              fontSize: 13,
              color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
            ),
          ),
          const SizedBox(height: 12),

          // Ligne médicament & prix
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: isDark ? AppColors.darkSurface : AppColors.lightBg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        medicineName,
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                      ),
                      if (genericAlternative != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          genericAlternative,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.accent,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Text(
                  '$priceXAF XAF',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 17,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 12),

          // Badge de fraîcheur et actions
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: freshnessStatus == 0
                          ? AppColors.statusAvailable
                          : AppColors.statusToConfirm,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    freshnessText,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: freshnessStatus == 0
                          ? AppColors.statusAvailable
                          : AppColors.statusToConfirm,
                    ),
                  ),
                ],
              ),
              Row(
                children: [
                  OutlinedButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (context) => PharmacyDetailScreen(
                            name: pharmacyName,
                            neighborhood: neighborhood,
                            distance: 'Proche',
                            isGuard: isGuard,
                            phone: '+237 222 00 00 00',
                          ),
                        ),
                      );
                    },
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    child: const Text('Détails', style: TextStyle(fontSize: 12)),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (context) => MedicineDetailScreen(
                            medicineName: medicineName,
                            pharmacyName: pharmacyName,
                            priceXAF: priceXAF,
                          ),
                        ),
                      );
                    },
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    child: const Text('Réserver', style: TextStyle(fontSize: 12)),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}
