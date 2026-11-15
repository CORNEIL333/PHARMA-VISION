import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../search/search_list_screen.dart';

class SearchHistoryScreen extends StatefulWidget {
  const SearchHistoryScreen({super.key});

  @override
  State<SearchHistoryScreen> createState() => _SearchHistoryScreenState();
}

class _SearchHistoryScreenState extends State<SearchHistoryScreen> {
  final List<Map<String, String>> _recentSearches = [
    {'query': 'Paracétamol 500mg', 'date': 'Aujourd\'hui, 14:20', 'type': 'medicine'},
    {'query': 'Pharmacie du Soleil', 'date': 'Hier, 18:45', 'type': 'pharmacy'},
    {'query': 'Amoxicilline 500mg', 'date': '12 Nov 2026', 'type': 'medicine'},
    {'query': 'Grande Pharmacie Bastos', 'date': '10 Nov 2026', 'type': 'pharmacy'},
    {'query': 'Artesunate + Amodiaquine', 'date': '08 Nov 2026', 'type': 'medicine'},
  ];

  void _clearHistory() {
    setState(() {
      _recentSearches.clear();
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Historique de recherche effacé')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Historique des recherches'),
        actions: [
          if (_recentSearches.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.delete_sweep_outlined),
              tooltip: 'Effacer tout',
              onPressed: _clearHistory,
            ),
        ],
      ),
      body: _recentSearches.isEmpty
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.history_toggle_off_rounded,
                    size: 64,
                    color: isDark ? AppColors.darkTextMuted : AppColors.lightTextMuted,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Aucun historique pour le moment',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Vos recherches récentes apparaîtront ici.',
                    style: TextStyle(
                      color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              itemCount: _recentSearches.length,
              separatorBuilder: (context, index) => Divider(
                height: 1,
                color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
              ),
              itemBuilder: (context, index) {
                final item = _recentSearches[index];
                final isMed = item['type'] == 'medicine';

                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: isMed ? AppColors.primaryLight : const Color(0xFFE0E7FF),
                    child: Icon(
                      isMed ? Icons.medication_outlined : Icons.storefront_outlined,
                      color: isMed ? AppColors.primary : const Color(0xFF4F46E5),
                      size: 20,
                    ),
                  ),
                  title: Text(
                    item['query']!,
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                  ),
                  subtitle: Text(
                    item['date']!,
                    style: TextStyle(
                      fontSize: 12,
                      color: isDark ? AppColors.darkTextMuted : AppColors.lightTextMuted,
                    ),
                  ),
                  trailing: IconButton(
                    icon: const Icon(Icons.north_west_rounded, size: 18),
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (context) => const SearchListScreen()),
                      );
                    },
                  ),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (context) => const SearchListScreen()),
                    );
                  },
                );
              },
            ),
    );
  }
}
