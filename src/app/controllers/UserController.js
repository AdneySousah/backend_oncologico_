import User from '../models/User.js';
import Operadora from '../models/Operadora.js'; // Importante para os relacionamentos
import * as Yup from 'yup';
import bcrypt from 'bcrypt';

class UserController {
  // CREATE
  async store(req, res) {
    const schema = Yup.object({
      name: Yup.string().required(),
      email: Yup.string().email().required(),
      password: Yup.string().required().min(6),
      is_profissional: Yup.boolean(),
      is_admin: Yup.boolean(),
      operadoras: Yup.array().of(Yup.number()), // Espera um array de IDs [1, 2, 3]
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({
        error: 'Validation fails',
        messages: err.inner.map(e => ({ field: e.path, message: e.message }))
      });
    }

    const { name, email, password, is_profissional, is_admin, operadoras } = req.body;

    const userExists = await User.findOne({ where: { email } });

    if (userExists) {
      return res.status(400).json({ error: 'User already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 8);

    const user = await User.create({ 
      name, 
      email, 
      password_hash, 
      active: true, 
      is_profissional, 
      is_admin 
    });

    // Se vieram IDs de operadoras na requisição, fazemos o vínculo aqui
    if (operadoras && operadoras.length > 0) {
      // Método mágico criado pelo belongsToMany do Sequelize
      await user.setOperadoras(operadoras); 
    }

    // Recarrega o usuário para incluir as operadoras na resposta de criação
    await user.reload({
      attributes: ['id', 'name', 'email', 'is_profissional', 'is_admin'],
      include: [
        {
          model: Operadora,
          as: 'operadoras',
          attributes: ['id', 'nome', 'cnpj'],
          through: { attributes: [] } // Esconde os dados da tabela intermediária na resposta
        }
      ]
    });

    return res.status(201).json(user);
  }

  // READ (Listagem)
  async index(req, res) {
    const users = await User.findAll({
      where: { active: true },
      attributes: ['id', 'name', 'email', 'active', 'is_profissional', 'is_admin'],
      include: [
        {
          model: Operadora,
          as: 'operadoras',
          attributes: ['id', 'nome', 'cnpj'], // Traz os dados da operadora vinculada
          through: { attributes: [] } 
        }
      ]
    });

    return res.json(users);
  }

  // UPDATE
  async update(req, res) {
    const { email, oldPassword, operadoras } = req.body;

    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    if (email && email !== user.email) {
      const userExists = await User.findOne({ where: { email } });
      if (userExists) {
        return res.status(400).json({ error: 'User already exists.' });
      }
    }

    if (oldPassword && !(await user.checkPassword(oldPassword))) {
      return res.status(401).json({ error: 'Password does not match' });
    }

    // Atualiza os dados básicos do usuário
    await user.update(req.body);

    // Se enviou um novo array de operadoras, substitui os vínculos antigos pelos novos
    if (operadoras) {
      await user.setOperadoras(operadoras);
    }

    // Recarrega o usuário com os novos dados e relacionamentos para retornar
    await user.reload({
      attributes: ['id', 'name', 'email', 'active', 'is_profissional', 'is_admin'],
      include: [
        {
          model: Operadora,
          as: 'operadoras',
          attributes: ['id', 'nome', 'cnpj'],
          through: { attributes: [] }
        }
      ]
    });

    return res.json(user);
  }

  // DELETE (Logicamente - Desativar)
  async delete(req, res) {
    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    await user.update({ active: false });

    return res.json({ message: 'User deactivated successfully' });
  }


  // Adicione este método dentro da classe UserController
  async changeFirstPassword(req, res) {
    const schema = Yup.object({
      oldPassword: Yup.string().required('A senha atual é obrigatória'),
      newPassword: Yup.string().required('A nova senha é obrigatória').min(6, 'A senha deve ter no mínimo 6 caracteres'),
      confirmPassword: Yup.string().oneOf([Yup.ref('newPassword'), null], 'As senhas não coincidem')
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
      console.log('Validação bem-sucedida:', req.body); // Log para verificar os dados recebidos
    } catch (err) {
      return res.status(400).json({
        error: 'Falha na validação',
        messages: err.inner.map(e => ({ field: e.path, message: e.message }))
      });
    }

    const { oldPassword, newPassword } = req.body;

    // Adicione este log para verificar os valores recebidos

    // req.userId vem do middleware de autenticação JWT que você já deve ter configurado nas rotas
    const user = await User.findByPk(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // Verifica se a senha antiga está correta
    if (!(await user.checkPassword(oldPassword))) {
      return res.status(401).json({ error: 'A senha atual está incorreta.' });
    }

    // Verifica se a nova senha é igual à antiga (não permitimos)
    if (await user.checkPassword(newPassword)) {
      return res.status(400).json({ error: 'A nova senha não pode ser igual à senha atual.' });
    }

    // Atualiza a senha e remove a flag de novo usuário
    const password_hash = await bcrypt.hash(newPassword, 8);
    
    try{
    await user.update({
      password_hash,
      is_new_user: false
    });
    }
    catch(err){
      
      return res.status(500).json({ error: 'Ocorreu um erro ao atualizar a senha. Por favor, tente novamente.' });
    }

    return res.status(200).json({ message: 'Senha atualizada com sucesso. Por favor, faça login novamente.' });
  }
}

export default new UserController();