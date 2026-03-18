import User from '../models/User.js';
import Operadora from '../models/Operadora.js';
import Perfil from '../models/Perfil.js';
import OncologyProfessional from '../models/OncologyProfessional.js';
import Especiality from '../models/Especiality.js'; // Garantir que está importado para o include
import * as Yup from 'yup';
import bcrypt from 'bcrypt';
import { Op,fn,col } from 'sequelize';
class UserController {
  // CREATE
 async store(req, res) {
    const schema = Yup.object({
      name: Yup.string().required(),
      email: Yup.string().email().required(),
      password: Yup.string().required().min(6),
      is_profissional: Yup.boolean(),
      is_admin: Yup.boolean(),
      perfil_id: Yup.number().required('O perfil de acesso é obrigatório'),
      operadoras: Yup.array().of(Yup.number()),
      professional_data: Yup.object().shape({
        registry_type: Yup.string(),
        registry_number: Yup.string(),
        especiality_id: Yup.number().nullable()
      }).nullable()
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({
        error: 'Validation fails',
        messages: err.inner.map(e => ({ field: e.path, message: e.message }))
      });
    }

    // Normalização: Transformamos o email em minúsculo antes de qualquer checagem ou inserção
    const { name, password, is_profissional, is_admin, operadoras, perfil_id, professional_data } = req.body;
    const email = req.body.email.toLowerCase();

    // Busca insensível a maiúsculas/minúsculas
    // Se usar PostgreSQL, o [Op.iLike] é o ideal. Se usar MySQL/SQLite, o lower() resolve.
    
    
    const userExists = await User.findOne({ 
      where: fn('lower', col('email')), 
      where: { email } 
    });

    if (userExists) {
      return res.status(400).json({ error: 'Email já foi cadastrado' });
    }

    const password_hash = await bcrypt.hash(password, 8);

    // Criação do usuário com o email já normalizado
    const user = await User.create({
      name,
      email,
      password_hash,
      active: true,
      is_profissional,
      is_admin,
      perfil_id
    });

    // Vínculo com Operadoras
    if (operadoras && operadoras.length > 0) {
      await user.setOperadoras(operadoras);
    }

    // Vínculo com dados profissionais
    if (is_profissional && professional_data && professional_data.registry_number) {
      await OncologyProfessional.create({
        user_id: user.id,
        registry_type: professional_data.registry_type,
        registry_number: professional_data.registry_number,
        especiality_id: professional_data.especiality_id
      });
    }

    // Recarrega o usuário para resposta com os relacionamentos
    await user.reload({
      attributes: ['id', 'name', 'email', 'active', 'is_profissional', 'is_admin', 'perfil_id'],
      include: [
        { 
          model: Operadora, 
          as: 'operadoras', 
          attributes: ['id', 'nome'], 
          through: { attributes: [] } 
        },
        { 
          model: Perfil, 
          as: 'perfil', 
          attributes: ['id', 'nome'] 
        },
        {
          model: OncologyProfessional,
          as: 'professional',
          attributes: ['registry_type', 'registry_number', 'especiality_id'],
          include: [{ model: Especiality, as: 'speciality', attributes: ['id', 'name'] }]
        }
      ]
    });

    return res.status(201).json(user);
  }
  // READ (Listagem)
  async index(req, res) {
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'active', 'is_profissional', 'is_admin', 'perfil_id'],
      include: [
        { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'], through: { attributes: [] } },
        { model: Perfil, as: 'perfil', attributes: ['id', 'nome'] },
        {
          model: OncologyProfessional,
          as: 'professional',
          attributes: ['id', 'registry_type', 'registry_number', 'especiality_id'], // <-- CORREÇÃO AQUI
          include: [{ model: Especiality, as: 'speciality', attributes: ['id', 'name'] }]
        }
      ]
    });

    return res.json(users);
  }

  // UPDATE
  async update(req, res) {
    const { email, oldPassword, operadoras, is_profissional, professional_data, perfil_id } = req.body;

    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(400).json({ error: 'Usuario não encontrado' });
    }

    if (email && email !== user.email) {
      const userExists = await User.findOne({ where: { email } });
      if (userExists) {
        return res.status(400).json({ error: 'Email ja foi utilizado' });
      }
    }

    if (oldPassword && !(await user.checkPassword(oldPassword))) {
      return res.status(401).json({ error: 'Senha não confere' });
    }

    // Atualiza os dados básicos
    await user.update({
      name: req.body.name,
      email: req.body.email,
      is_admin: req.body.is_admin,
      is_profissional: is_profissional,
      perfil_id: perfil_id
    });

    if (operadoras) {
      await user.setOperadoras(operadoras);
    }

    if (is_profissional && professional_data) {
      const profProfile = await OncologyProfessional.findOne({ where: { user_id: user.id } });

      if (profProfile) {
        await profProfile.update(professional_data);
      } else {
        await OncologyProfessional.create({
          user_id: user.id,
          ...professional_data
        });
      }
    } else if (!is_profissional) {
      // Opcional: Se ele deixar de ser profissional, podemos deletar o registro profissional dele
      await OncologyProfessional.destroy({ where: { user_id: user.id } });
    }

    // Recarrega o usuário completo (AGORA TRAZENDO O especiality_id)
    await user.reload({
      attributes: ['id', 'name', 'email', 'active', 'is_profissional', 'is_admin', 'perfil_id'],
      include: [
        { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'], through: { attributes: [] } },
        { model: Perfil, as: 'perfil', attributes: ['id', 'nome'] },
        {
          model: OncologyProfessional,
          as: 'professional',
          attributes: ['id', 'registry_type', 'registry_number', 'especiality_id'], // <-- CORREÇÃO AQUI
          include: [{ model: Especiality, as: 'speciality', attributes: ['name'] }]
        }
      ]
    });

    return res.json(user);
  }

  // DELETE
  async delete(req, res) {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(400).json({ error: 'User not found' });

    // Inverte o status atual: se true vira false, se false vira true
    const newStatus = !user.active;
    await user.update({ active: newStatus });

    return res.json({
      message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`,
      active: newStatus
    });
  }

  // CHANGE PASSWORD
  async changeFirstPassword(req, res) {
    const schema = Yup.object({
      oldPassword: Yup.string().required('A senha atual é obrigatória'),
      newPassword: Yup.string().required('A nova senha é obrigatória').min(6, 'A senha deve ter no mínimo 6 caracteres'),
      confirmPassword: Yup.string().oneOf([Yup.ref('newPassword'), null], 'As senhas não coincidem')
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({
        error: 'Falha na validação',
        messages: err.inner.map(e => ({ field: e.path, message: e.message }))
      });
    }

    const { oldPassword, newPassword } = req.body;
    const user = await User.findByPk(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!(await user.checkPassword(oldPassword))) {
      return res.status(401).json({ error: 'A senha atual está incorreta.' });
    }

    if (await user.checkPassword(newPassword)) {
      return res.status(400).json({ error: 'A nova senha não pode ser igual à senha atual.' });
    }

    const password_hash = await bcrypt.hash(newPassword, 8);

    try {
      await user.update({
        password_hash,
        is_new_user: false
      });
    } catch (err) {
      return res.status(500).json({ error: 'Ocorreu um erro ao atualizar a senha. Por favor, tente novamente.' });
    }

    return res.status(200).json({ message: 'Senha atualizada com sucesso. Por favor, faça login novamente.' });
  }


  // GET ME (Busca os dados do usuário logado)
  async profile(req, res) {
    try {
      const user = await User.findByPk(req.userId, {
        attributes: ['id', 'name', 'email', 'is_admin', 'is_profissional', 'perfil_id'],
        include: [
          {
            model: Operadora,
            as: 'operadoras',
            attributes: ['id', 'nome'],
            through: { attributes: [] }
          }
        ]
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      return res.json(user);
    } catch (error) {
      console.error("Erro ao buscar perfil do usuário:", error);
      return res.status(500).json({ error: 'Erro interno ao buscar dados do usuário.' });
    }
  }
}

export default new UserController();