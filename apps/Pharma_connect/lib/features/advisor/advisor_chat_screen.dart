import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../search/search_list_screen.dart';
import '../prescription/prescription_upload_screen.dart';

class AdvisorChatScreen extends StatefulWidget {
  const AdvisorChatScreen({super.key});

  @override
  State<AdvisorChatScreen> createState() => _AdvisorChatScreenState();
}

class _AdvisorChatScreenState extends State<AdvisorChatScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  final List<Map<String, dynamic>> _messages = [
    {
      'isUser': false,
      'text':
          'Bonjour ! Je suis votre Conseiller Virtuel PharmaConnect. Je peux vous aider à localiser une pharmacie de garde, vérifier un stock ou vous guider dans la transmission de votre ordonnance.',
      'time': '14:30',
    },
    {
      'isUser': false,
      'text':
          'Rappel important : Je ne pose aucun diagnostic médical et ne remplace pas l\'avis de votre médecin ou de votre pharmacien.',
      'time': '14:30',
    },
  ];

  final List<String> _suggestedQuestions = [
    'Où trouver une pharmacie de garde ?',
    'C\'est quoi un médicament générique ?',
    'Comment réserver une ordonnance ?',
    'Quelle officine a du Paracétamol ?',
  ];

  void _sendMessage(String text) {
    if (text.trim().isEmpty) return;

    setState(() {
      _messages.add({
        'isUser': true,
        'text': text.trim(),
        'time': '14:32',
      });
    });
    _messageController.clear();

    // Réponse intelligente simulée du conseiller
    Future.delayed(const Duration(milliseconds: 600), () {
      String response = 'Je consulte les disponibilités auprès des officines partenaires de votre secteur...';
      if (text.toLowerCase().contains('garde')) {
        response =
            'À Yaoundé aujourd\'hui, la Pharmacie du Soleil (Omnisports) et la Pharmacie de Bastos assurent la garde 24h/24. Souhaitez-vous voir l\'itinéraire ?';
      } else if (text.toLowerCase().contains('générique')) {
        response =
            'Un générique possède le même principe actif et la même efficacité que le princeps de marque, souvent à un prix inférieur de 30% à 50%. Parlez-en à votre pharmacien lors de la délivrance !';
      } else if (text.toLowerCase().contains('ordonnance')) {
        response =
            'Pour réserver avec une ordonnance, utilisez le bouton "Transmettre ordonnance". Vous prenez une photo nette et l\'officine prépare vos médicaments.';
      } else if (text.toLowerCase().contains('paracétamol') || text.toLowerCase().contains('doliprane')) {
        response =
            'Le Paracétamol 500mg est actuellement disponible à la Pharmacie du Soleil (1 250 XAF) et en générique DCI à 600 XAF.';
      }

      setState(() {
        _messages.add({
          'isUser': false,
          'text': response,
          'time': '14:32',
        });
      });

      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent + 80,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: const BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
              ),
              padding: const EdgeInsets.all(2),
              child: Image.asset(
                'assets/ia_conseiller.png',
                fit: BoxFit.contain,
              ),
            ),
            const SizedBox(width: 10),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Conseiller Virtuel',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                Text(
                  'Orientation & stocks en direct',
                  style: TextStyle(fontSize: 11, color: AppColors.primary),
                ),
              ],
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          // Bandeau éthique non intrusif
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: isDark ? AppColors.darkCard : const Color(0xFFF1F5F9),
            child: Row(
              children: [
                const Icon(Icons.shield_outlined, size: 16, color: AppColors.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Orientation pratique sans diagnostic ni prescription médicale.',
                    style: TextStyle(
                      fontSize: 11,
                      color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Liste des messages de la conversation
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                final isUser = msg['isUser'] as bool;

                return Align(
                  alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    constraints: BoxConstraints(
                      maxWidth: MediaQuery.of(context).size.width * 0.78,
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    decoration: BoxDecoration(
                      color: isUser
                          ? AppColors.primary
                          : (isDark ? AppColors.darkCard : Colors.white),
                      borderRadius: BorderRadius.only(
                        topLeft: const Radius.circular(16),
                        topRight: const Radius.circular(16),
                        bottomLeft: Radius.circular(isUser ? 16 : 4),
                        bottomRight: Radius.circular(isUser ? 4 : 16),
                      ),
                      border: isUser
                          ? null
                          : Border.all(
                              color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                            ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.04),
                          blurRadius: 6,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          msg['text'],
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.4,
                            color: isUser
                                ? Colors.white
                                : (isDark ? AppColors.darkTextPrimary : AppColors.lightTextPrimary),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Align(
                          alignment: Alignment.bottomRight,
                          child: Text(
                            msg['time'],
                            style: TextStyle(
                              fontSize: 10,
                              color: isUser
                                  ? Colors.white70
                                  : (isDark ? AppColors.darkTextMuted : AppColors.lightTextMuted),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),

          // Questions suggérées
          Container(
            height: 44,
            margin: const EdgeInsets.only(bottom: 6),
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _suggestedQuestions.length,
              itemBuilder: (context, index) {
                final q = _suggestedQuestions[index];
                return Padding(
                  padding: const EdgeInsets.only(right: 8.0),
                  child: ActionChip(
                    label: Text(q, style: const TextStyle(fontSize: 12)),
                    backgroundColor: isDark ? AppColors.darkCard : Colors.white,
                    side: BorderSide(
                      color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                    ),
                    onPressed: () => _sendMessage(q),
                  ),
                );
              },
            ),
          ),

          // Zone de saisie
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: isDark ? AppColors.darkSurface : Colors.white,
              border: Border(
                top: BorderSide(
                  color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                ),
              ),
            ),
            child: SafeArea(
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _messageController,
                      decoration: const InputDecoration(
                        hintText: 'Posez votre question...',
                        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      ),
                      onSubmitted: _sendMessage,
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: () => _sendMessage(_messageController.text),
                    style: IconButton.styleFrom(backgroundColor: AppColors.primary),
                    icon: const Icon(Icons.send_rounded, color: Colors.white, size: 20),
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
